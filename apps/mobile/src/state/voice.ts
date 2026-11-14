import { getLocale, t } from '@ai-todo/shared';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import {
  type ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';
import { Platform } from 'react-native';
import { makeMutable, withTiming } from 'react-native-reanimated';
import { create } from 'zustand';
import { getReplica } from './actions';
import { getSetting, setSetting } from './storage';
import { useSync } from './sync';

/**
 * Speech capture for the assistant.
 *
 * - **System** (default): the platform recognizer (SFSpeechRecognizer / Android SpeechRecognizer),
 *   free, with live partial results; project and label names are passed as contextual strings.
 * - **Cloud**: the same recognizer runs for the live preview while the audio is recorded to a
 *   file, which the sync server transcribes (`/api/ai/transcribe`); its text wins, and the system
 *   text is the fallback when the upload fails.
 *
 * Push-to-talk stops when the finger lifts; hands-free stops after a short silence.
 */

export type SpeechMode = 'system' | 'cloud';

export function getSpeechMode(): SpeechMode {
  return getSetting<SpeechMode>('speech.mode') ?? 'system';
}

export function setSpeechMode(mode: SpeechMode): void {
  setSetting('speech.mode', mode);
  useVoice.setState({ mode });
}

export type VoiceStatus = 'idle' | 'starting' | 'listening' | 'transcribing';

interface VoiceState {
  status: VoiceStatus;
  /** Live transcript. */
  text: string;
  handsFree: boolean;
  error: string | null;
  mode: SpeechMode;
}

export const useVoice = create<VoiceState>(() => ({
  status: 'idle',
  text: '',
  handsFree: false,
  error: null,
  mode: getSpeechMode(),
}));

/** Microphone level 0…1, smoothed; animated without re-rendering. */
export const voiceLevel = makeMutable(0);

/** After this much quiet, a hands-free session ends by itself. */
const SILENCE_MS = 1600;
/** A hands-free session that hears nothing gives up after this long. */
const NOTHING_MS = 7000;

interface Session {
  committed: string;
  partial: string;
  uri: string | null;
  cancelled: boolean;
  cloud: boolean;
  error: string | null;
  resolve: (text: string | null) => void;
  silence: ReturnType<typeof setTimeout> | null;
}

let session: Session | null = null;
let wired = false;

const joiner = () => (getLocale() === 'zh' ? '' : ' ');
const current = (s: Session) =>
  [s.committed, s.partial].filter(Boolean).join(joiner()).replace(/\s+/g, ' ').trim();

function vocabulary(): string[] {
  try {
    const s = getReplica().store;
    const names = [
      ...s
        .all('project')
        .filter((p) => !p.deletedAt && !p.archivedAt)
        .map((p) => p.name),
      ...s
        .all('label')
        .filter((l) => !l.deletedAt)
        .map((l) => l.name),
    ];
    return [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, 100);
  } catch {
    return [];
  }
}

function armSilence(s: Session, ms: number): void {
  if (s.silence) clearTimeout(s.silence);
  s.silence = setTimeout(() => {
    if (session === s && useVoice.getState().handsFree) ExpoSpeechRecognitionModule.stop();
  }, ms);
}

function errorText(e: ExpoSpeechRecognitionErrorEvent): string | null {
  switch (e.error) {
    case 'aborted':
      return null;
    case 'no-speech':
    case 'speech-timeout':
      return t('agent.noSpeech');
    case 'not-allowed':
      return t('agent.micDenied');
    case 'service-not-allowed':
    case 'language-not-supported':
      return t('agent.speechUnsupported');
    case 'network':
      return t('settings.sync.status.offline');
    default:
      return e.message || e.error;
  }
}

function wire(): void {
  if (wired) return;
  wired = true;
  ExpoSpeechRecognitionModule.addListener('start', () => {
    if (session) useVoice.setState({ status: 'listening' });
  });
  ExpoSpeechRecognitionModule.addListener('result', (e: ExpoSpeechRecognitionResultEvent) => {
    const s = session;
    if (!s) return;
    const text = e.results[0]?.transcript?.trim() ?? '';
    if (e.isFinal) {
      if (text) s.committed = [s.committed, text].filter(Boolean).join(joiner());
      s.partial = '';
    } else s.partial = text;
    useVoice.setState({ text: current(s) });
    if (text) armSilence(s, SILENCE_MS);
  });
  ExpoSpeechRecognitionModule.addListener('volumechange', (e: { value: number }) => {
    voiceLevel.value = withTiming(Math.max(0, Math.min(1, (e.value + 2) / 12)), { duration: 90 });
  });
  ExpoSpeechRecognitionModule.addListener('audioend', (e: { uri: string | null }) => {
    if (session && e.uri) session.uri = e.uri;
  });
  ExpoSpeechRecognitionModule.addListener('error', (e: ExpoSpeechRecognitionErrorEvent) => {
    if (session) session.error = errorText(e);
  });
  ExpoSpeechRecognitionModule.addListener('end', () => {
    const s = session;
    if (!s) return;
    void finish(s);
  });
}

async function finish(s: Session): Promise<void> {
  if (s.silence) clearTimeout(s.silence);
  voiceLevel.value = withTiming(0, { duration: 150 });
  let text = current(s);
  if (!s.cancelled && s.cloud && s.uri) {
    useVoice.setState({ status: 'transcribing' });
    const cloud = await transcribeFile(s.uri, text);
    if (cloud) text = cloud;
  }
  if (s.uri) {
    try {
      new File(s.uri).delete();
    } catch {
      /* already gone */
    }
  }
  if (session === s) session = null;
  if (s.cancelled) {
    useVoice.setState({ status: 'idle', text: '', handsFree: false, error: null });
    s.resolve(null);
    return;
  }
  const error = text ? null : (s.error ?? t('agent.noSpeech'));
  useVoice.setState({ status: 'idle', text, handsFree: false, error });
  s.resolve(text || null);
}

/** Upload the recording to the sync server; `null` means "use the system's text". */
async function transcribeFile(uri: string, fallback: string): Promise<string | null> {
  const cfg = useSync.getState().config;
  if (!cfg) return null;
  const zh = getLocale() === 'zh';
  const hint = vocabulary()
    .join(zh ? '、' : ', ')
    .slice(0, 600);
  const url = `${cfg.url}/api/ai/transcribe?lang=${zh ? 'zh' : 'en'}${hint ? `&hint=${encodeURIComponent(hint)}` : ''}`;
  try {
    const res = await new File(uri).upload(url, {
      httpMethod: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'audio/wav' },
      mimeType: 'audio/wav',
    });
    if (res.status >= 400) {
      console.warn('cloud transcription failed', res.status, res.body.slice(0, 200));
      return null;
    }
    const text = (JSON.parse(res.body) as { text?: string }).text?.trim();
    return text || (fallback ? null : '');
  } catch (e) {
    console.warn('cloud transcription failed', e);
    return null;
  }
}

/**
 * Start listening. Resolves with what was said once the session ends (finger lifted, silence in
 * hands-free mode, or {@link stopListening}); `null` when cancelled or nothing was heard.
 */
export async function listen(opts: { handsFree: boolean }): Promise<string | null> {
  if (session) {
    // Let the previous session's `end` arrive first, so it can't end this one.
    cancelListening();
    for (let i = 0; i < 20 && session; i++) await new Promise((r) => setTimeout(r, 40));
  }
  wire();
  useVoice.setState({ status: 'starting', text: '', handsFree: opts.handsFree, error: null });
  const fail = (message: string) => {
    useVoice.setState({ status: 'idle', error: message, handsFree: false });
    return null;
  };
  let available = false;
  try {
    available = ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    available = false;
  }
  if (!available) return fail(t('agent.speechUnsupported'));
  const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  if (!perm.granted) return fail(t('agent.micDenied'));
  // The finger may have lifted (and cancelled) while the permission prompt was up.
  if (useVoice.getState().status !== 'starting') return null;

  const cloud =
    useVoice.getState().mode === 'cloud' &&
    !!useSync.getState().ai?.speech &&
    (Platform.OS === 'web' ? false : ExpoSpeechRecognitionModule.supportsRecording());
  const zh = getLocale() === 'zh';
  return new Promise<string | null>((resolve) => {
    const s: Session = {
      committed: '',
      partial: '',
      uri: null,
      cancelled: false,
      cloud,
      error: null,
      resolve,
      silence: null,
    };
    session = s;
    try {
      ExpoSpeechRecognitionModule.start({
        lang: zh ? 'zh-CN' : 'en-US',
        interimResults: true,
        addsPunctuation: true,
        // Push-to-talk keeps going through pauses; hands-free ends on our own silence timer.
        continuous: true,
        contextualStrings: vocabulary(),
        iosTaskHint: 'dictation',
        volumeChangeEventOptions: { enabled: true, intervalMillis: 80 },
        ...(cloud
          ? { recordingOptions: { persist: true, outputSampleRate: 16000, outputEncoding: 'pcmFormatInt16' } }
          : {}),
      });
      // A tap may already have switched this session to hands-free while permissions were checked.
      if (useVoice.getState().handsFree) armSilence(s, NOTHING_MS);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e) {
      session = null;
      resolve(fail((e as Error).message));
    }
  });
}

/** Switch a running push-to-talk session to hands-free (the press turned out to be a tap). */
export function goHandsFree(): void {
  useVoice.setState({ handsFree: true });
  if (session) armSilence(session, current(session) ? SILENCE_MS : NOTHING_MS);
}

/** End the session and keep what was said. */
export function stopListening(): void {
  if (session) ExpoSpeechRecognitionModule.stop();
  else if (useVoice.getState().status === 'starting') useVoice.setState({ status: 'idle' });
}

/** End the session and throw away what was said. */
export function cancelListening(): void {
  const s = session;
  if (s) {
    s.cancelled = true;
    ExpoSpeechRecognitionModule.abort();
    // Some platforms don't send `end` after abort; make sure the session closes.
    setTimeout(() => {
      if (session === s) void finish(s);
    }, 600);
  } else useVoice.setState({ status: 'idle', text: '', handsFree: false });
}

export function clearVoiceError(): void {
  useVoice.setState({ error: null });
}
