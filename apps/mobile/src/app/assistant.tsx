import type { AssistantTurn, TurnStatus } from '@ai-todo/core';
import { type ChangeLine, describeChanges, getLocale, t } from '@ai-todo/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowUp, Check, MessageSquarePlus, RotateCcw, Undo2, X } from 'lucide-react-native';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Press, Txt } from '../components/ui';
import { LevelBars, MicButton, talkHandsFree } from '../components/Voice';
import { getReplica } from '../state/actions';
import {
  getAssistant,
  speak,
  useAssistant,
  useAssistantAvailable,
  useAssistantFocus,
} from '../state/assistant';
import { useToday } from '../state/replica';
import { cancelListening, clearVoiceError, useVoice } from '../state/voice';
import { type Colors, readable, useColors } from '../theme';

const TOOL_LABEL: Record<string, [string, string]> = {
  'get-overview': ['看清单', 'Reading the list'],
  'find-tasks': ['找任务', 'Finding tasks'],
  'find-tasks-by-date': ['看日程', 'Checking dates'],
  'add-tasks': ['添加', 'Adding'],
  'update-tasks': ['修改', 'Editing'],
  'complete-tasks': ['完成', 'Completing'],
  'reschedule-tasks': ['改日期', 'Rescheduling'],
  'delete-tasks': ['删除', 'Deleting'],
  'create-project': ['建项目', 'Creating a project'],
  'undo-last-change': ['撤销', 'Undoing'],
};

function toolLabel(name: string): string {
  const l = TOOL_LABEL[name];
  return l ? (getLocale() === 'zh' ? l[0] : l[1]) : name;
}

function kindColor(c: Colors, kind: ChangeLine['kind']): string {
  switch (kind) {
    case 'deleted':
      return c.danger;
    case 'updated':
      return c.p3;
    case 'reopened':
    case 'restored':
      return c.p2;
    default:
      return c.jade;
  }
}

/** Example phrases from `agent.examples` (the quoted parts), offered as one-tap prompts. */
function examples(): string[] {
  return [...t('agent.examples').matchAll(/[“"]([^”"]+)[”"]/g)].map((m) => m[1] as string);
}

/** Talk to Docket: the conversation, what changed, and the mic. */
export default function AssistantScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { listen } = useLocalSearchParams<{ listen?: string }>();
  const state = useAssistant();
  const available = useAssistantAvailable();
  const voice = useVoice();
  const [text, setText] = useState('');
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);

  useEffect(() => {
    useAssistantFocus.setState({ sheetOpen: true });
    if (listen) talkHandsFree();
    return () => {
      useAssistantFocus.setState({ sheetOpen: false });
      if (useVoice.getState().handsFree) cancelListening();
      clearVoiceError();
    };
  }, [listen]);

  const send = () => {
    const s = text.trim();
    if (!s) return;
    setText('');
    speak(s);
  };

  const empty = !state.turns.length && voice.status !== 'listening' && voice.status !== 'transcribing';
  const live = voice.status !== 'idle' ? voice.text : '';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: c.bg }}
    >
      <View style={[styles.head, { paddingTop: 16 + (Platform.OS === 'android' ? insets.top : 0) }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('cancel')}
        >
          <X size={24} color={c.ink2} />
        </Pressable>
        <Txt variant="title">{t('agent.title')}</Txt>
        <Pressable
          onPress={() => getAssistant().forget()}
          hitSlop={12}
          disabled={!state.turns.length}
          accessibilityRole="button"
          accessibilityLabel={t('agent.new')}
          style={{ opacity: state.turns.length ? 1 : 0.3 }}
        >
          <MessageSquarePlus size={22} color={c.ink2} />
        </Pressable>
      </View>

      <ScrollView
        ref={scroll}
        contentContainerStyle={[styles.list, readable]}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        {!available ? (
          <View style={[styles.notice, { backgroundColor: c.surface, borderColor: c.line }]}>
            <Txt variant="label">{t('agent.unavailable')}</Txt>
            <Press onPress={() => router.push('/settings')} accessibilityRole="button">
              <Txt tone={c.jade} style={{ fontWeight: '600' }}>
                {t('settings.title')}
              </Txt>
            </Press>
          </View>
        ) : null}
        {empty ? <Examples /> : null}
        {state.turns.map((turn, i) => (
          <Turn key={turn.id} turn={turn} last={i === state.turns.length - 1} />
        ))}
        {voice.status === 'listening' || voice.status === 'transcribing' ? (
          <Animated.View
            entering={FadeIn.duration(160)}
            style={[styles.heard, { backgroundColor: c.jadeSoft }]}
          >
            {live ? <Txt style={{ fontSize: 17, lineHeight: 24 }}>{live}</Txt> : <LevelBars color={c.jade} />}
            <Txt variant="meta" tone={c.jade} style={{ marginTop: 4 }}>
              {voice.status === 'transcribing' ? t('agent.transcribing') : t('agent.listening')}
            </Txt>
          </Animated.View>
        ) : null}
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 10, borderTopColor: c.line }]}>
        {voice.error ? (
          <Txt variant="meta" tone={c.p1} style={{ textAlign: 'center' }} accessibilityLiveRegion="polite">
            {voice.error}
          </Txt>
        ) : (
          <Txt variant="meta" style={{ textAlign: 'center' }}>
            {voice.status === 'idle'
              ? `${t('agent.tap')} · ${t('agent.hold')}`
              : voice.handsFree
                ? getLocale() === 'zh'
                  ? '说完会自动发送，点一下停止'
                  : 'Sends when you pause · tap to stop'
                : t('agent.release')}
          </Txt>
        )}
        <View style={styles.inputRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            onSubmitEditing={send}
            returnKeyType="send"
            placeholder={t('agent.placeholder')}
            placeholderTextColor={c.ink3}
            style={[styles.input, { color: c.ink, backgroundColor: c.surface, borderColor: c.line }]}
            accessibilityLabel={t('agent.placeholder')}
          />
          {text.trim() ? (
            <Press
              onPress={send}
              accessibilityRole="button"
              accessibilityLabel={t('agent.send')}
              scaleTo={0.9}
            >
              <View style={[styles.send, { backgroundColor: c.jade }]}>
                <ArrowUp color={c.jadeInk} size={22} strokeWidth={2.6} />
              </View>
            </Press>
          ) : (
            <MicButton size={56} />
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Examples() {
  const c = useColors();
  const zh = getLocale() === 'zh';
  return (
    <Animated.View entering={FadeInDown.duration(240)} style={{ gap: 12, paddingTop: 12 }}>
      <Txt variant="large" style={{ fontSize: 26, lineHeight: 30 }}>
        {zh ? '想让我做什么？' : 'What should I do?'}
      </Txt>
      <Txt variant="label">
        {zh
          ? '按住麦克风说话，松开就办。加任务、改日期、勾掉做完的、问今天还有什么都行。'
          : 'Hold the mic and talk; let go and it’s done. Add tasks, move dates, check things off, or ask what’s left.'}
      </Txt>
      <View style={{ gap: 8, marginTop: 4 }}>
        {examples().map((ex) => (
          <Press key={ex} onPress={() => speak(ex)} accessibilityRole="button">
            <View style={[styles.example, { borderColor: c.line, backgroundColor: c.surface }]}>
              <Txt style={{ fontSize: 15 }}>“{ex}”</Txt>
            </View>
          </Press>
        ))}
      </View>
    </Animated.View>
  );
}

function Turn({ turn, last }: { turn: AssistantTurn; last: boolean }) {
  const c = useColors();
  const today = useToday();
  const lines = turn.changes.length ? describeChanges(turn.changes, getReplica().store, today) : [];
  const muted = turn.status === 'undone' || turn.status === 'cancelled';
  return (
    <Animated.View entering={FadeInDown.duration(220)} layout={LinearTransition} style={{ gap: 8 }}>
      <View style={[styles.heard, { backgroundColor: c.jadeSoft }]}>
        <Txt style={{ fontSize: 17, lineHeight: 24 }}>{turn.heard}</Txt>
      </View>
      {turn.reply ? (
        <Txt style={{ fontSize: 16, lineHeight: 23, paddingHorizontal: 4 }} accessibilityLiveRegion="polite">
          {turn.reply}
        </Txt>
      ) : null}
      {turn.status === 'thinking' ? (
        <View style={styles.thinking}>
          <ActivityIndicator size="small" color={c.jade} />
          <Txt variant="meta">
            {[t('agent.thinking'), ...[...new Set(turn.tools)].map(toolLabel)].join(' · ')}
          </Txt>
        </View>
      ) : null}
      {lines.length ? (
        <View
          style={[
            styles.card,
            {
              borderColor: turn.status === 'pending' ? c.p2 : c.line,
              backgroundColor: c.surface,
              opacity: muted ? 0.5 : 1,
              borderStyle: turn.status === 'pending' || turn.status === 'thinking' ? 'dashed' : 'solid',
            },
          ]}
        >
          {lines.map((l) => (
            <Line key={l.key} line={l} struck={muted} />
          ))}
        </View>
      ) : null}
      <Status turn={turn} last={last} count={lines.length} />
      {turn.answer ? (
        <View style={[styles.heard, { backgroundColor: c.jadeSoft }]}>
          <Txt style={{ fontSize: 17, lineHeight: 24 }}>{turn.answer}</Txt>
        </View>
      ) : null}
    </Animated.View>
  );
}

function Line({ line, struck }: { line: ChangeLine; struck: boolean }) {
  const c = useColors();
  const tone = kindColor(c, line.kind);
  const badge = line.entity === 'task' ? t(`change.${line.kind}` as 'change.added') : line.detail;
  return (
    <Pressable
      disabled={!line.taskId || line.kind === 'deleted' || struck}
      onPress={() => line.taskId && router.push(`/task/${line.taskId}`)}
      style={styles.line}
      accessibilityLabel={`${badge} ${line.title} ${line.entity === 'task' ? line.detail : ''}`}
    >
      <View style={[styles.badge, { backgroundColor: `${tone}1F` }]}>
        <Txt style={{ fontSize: 12, fontWeight: '700', color: tone }}>{badge}</Txt>
      </View>
      <View style={{ flex: 1 }}>
        <Txt
          style={{
            fontSize: 15.5,
            fontWeight: '500',
            textDecorationLine: struck || line.kind === 'deleted' ? 'line-through' : 'none',
          }}
          numberOfLines={2}
        >
          {line.title}
        </Txt>
        {line.entity === 'task' && line.detail ? (
          <Txt variant="meta" style={{ marginTop: 1 }} numberOfLines={2}>
            {line.detail}
          </Txt>
        ) : null}
      </View>
    </Pressable>
  );
}

function Status({ turn, last, count }: { turn: AssistantTurn; last: boolean; count: number }) {
  const c = useColors();
  const a = getAssistant();
  const status: TurnStatus = turn.status;
  if (status === 'pending') {
    return (
      <View style={{ gap: 8 }}>
        <Txt variant="meta" tone={c.p2}>
          {t('agent.pending')}
        </Txt>
        <View style={styles.actions}>
          <Btn label={t('agent.cancel')} onPress={() => a.cancel()} />
          <Btn
            primary
            label={t('agent.confirm')}
            icon={<Check size={17} color={c.jadeInk} />}
            onPress={() => a.confirm()}
          />
        </View>
      </View>
    );
  }
  if (status === 'applied' && count) {
    return (
      <View style={styles.statusRow}>
        <Check size={15} color={c.jade} />
        <Txt variant="meta" tone={c.jade} style={{ flex: 1 }}>
          {t('agent.toast.applied', { n: count })}
        </Txt>
        <Press
          onPress={() => a.undo(turn.id)}
          accessibilityRole="button"
          accessibilityLabel={t('agent.undo')}
        >
          <View style={styles.inline}>
            <Undo2 size={15} color={c.ink2} />
            <Txt variant="meta" tone={c.ink2} style={{ fontWeight: '600' }}>
              {t('agent.undo')}
            </Txt>
          </View>
        </Press>
      </View>
    );
  }
  if (status === 'undone') return <Txt variant="meta">{t('agent.undone')}</Txt>;
  if (status === 'cancelled' && (count || !turn.reply))
    return <Txt variant="meta">{t('agent.cancelled')}</Txt>;
  if (status === 'error') {
    return (
      <View style={styles.statusRow}>
        <Txt variant="meta" tone={c.p1} style={{ flex: 1 }}>
          {t('ai.unavailable', { message: turn.error ?? '' })}
        </Txt>
        {last ? (
          <Press onPress={() => speak(turn.heard)} accessibilityRole="button">
            <View style={styles.inline}>
              <RotateCcw size={15} color={c.ink2} />
              <Txt variant="meta" tone={c.ink2} style={{ fontWeight: '600' }}>
                {getLocale() === 'zh' ? '重试' : 'Retry'}
              </Txt>
            </View>
          </Press>
        ) : null}
      </View>
    );
  }
  return null;
}

function Btn({
  label,
  onPress,
  primary,
  icon,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  icon?: ReactNode;
}) {
  const c = useColors();
  return (
    <View style={{ flex: 1 }}>
      <Press onPress={onPress} accessibilityRole="button">
        <View style={[styles.btn, { backgroundColor: primary ? c.jade : c.hover }]}>
          {icon}
          <Txt style={{ color: primary ? c.jadeInk : c.ink, fontWeight: '600', fontSize: 15.5 }}>{label}</Txt>
        </View>
      </Press>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  list: { padding: 16, gap: 18, paddingBottom: 24 },
  notice: {
    gap: 8,
    padding: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  example: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  heard: {
    alignSelf: 'flex-end',
    maxWidth: '88%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderBottomRightRadius: 6,
  },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingVertical: 6,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, marginTop: 1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 6 },
  actions: { flexDirection: 'row', gap: 10 },
  btn: {
    height: 44,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: { paddingHorizontal: 16, paddingTop: 10, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: 18,
    fontSize: 16,
  },
  send: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 8,
  },
});
