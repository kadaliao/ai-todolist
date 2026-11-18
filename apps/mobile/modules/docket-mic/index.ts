import { type EventSubscription, requireOptionalNativeModule } from 'expo';

/**
 * 16 kHz mono 16-bit microphone capture for streaming speech recognition (native module in
 * `ios/` and `android/`). `null` where the native side isn't built in (web, Expo Go).
 */
export interface MicAudioEvent {
  /** Base64 little-endian PCM, ~100 ms. */
  data: string;
  /** Loudness 0…1. */
  level: number;
}

export interface MicResult {
  /** `file://` WAV of the whole take. */
  uri?: string;
  duration?: number;
}

interface DocketMicNative {
  start(): Promise<void>;
  stop(): Promise<MicResult>;
  cancel(): void;
  addListener(event: 'onAudio', listener: (e: MicAudioEvent) => void): EventSubscription;
  addListener(event: 'onEnd', listener: (e: { reason: string }) => void): EventSubscription;
}

export const DocketMic = requireOptionalNativeModule<DocketMicNative>('DocketMic');
