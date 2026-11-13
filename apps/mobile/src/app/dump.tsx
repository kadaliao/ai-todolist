import { parseQuickAdd } from '@ai-todo/core';
import { describeRecurrence, formatScheduled, getLocale, t } from '@ai-todo/shared';
import { router } from 'expo-router';
import { Sparkles, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
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
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../components/ui';
import { addTasks, getReplica, toast, undo } from '../state/actions';
import { draftToTask, type ExtractedTask, extractTasks } from '../state/ai';
import { timeZone, useToday } from '../state/replica';
import { useColors } from '../theme';

interface Draft {
  key: number;
  include: boolean;
  data: ExtractedTask;
}

/** Say or paste anything; the AI drafts tasks (dashed), you keep what's right. */
export default function DumpScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const today = useToday();
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<(() => void) | null>(null);
  const seq = useRef(0);
  const zh = getLocale() === 'zh';
  useEffect(() => () => abort.current?.(), []);

  const extract = () => {
    setBusy(true);
    setError(null);
    setDrafts([]);
    abort.current = extractTasks(
      getReplica(),
      text,
      (item) => setDrafts((d) => [...(d ?? []), { key: ++seq.current, include: true, data: item }]),
      (err) => {
        setBusy(false);
        if (err) {
          setError(err);
          setDrafts(null);
        }
      },
    );
  };

  const splitLocally = () => {
    const parts = text
      .split(/[\n。；;！!？?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1);
    setDrafts(
      parts.map((p) => {
        const parsed = parseQuickAdd(p, { now: new Date(), timeZone: timeZone() });
        const when = parsed.tokens
          .filter((x) => x.kind === 'date' || x.kind === 'recurrence')
          .map((x) => x.text)
          .join(' ');
        return {
          key: ++seq.current,
          include: true,
          data: { title: parsed.title || p, ...(when ? { when } : {}) },
        };
      }),
    );
  };

  const add = () => {
    const chosen = (drafts ?? []).filter((d) => d.include && d.data.title.trim());
    if (!chosen.length) return;
    addTasks(
      chosen.map((d) => draftToTask(getReplica(), d.data)),
      'ai',
    );
    toast(t('toast.addedN', { n: chosen.length }), { label: t('undo'), run: undo });
    router.back();
  };

  const included = drafts?.filter((d) => d.include).length ?? 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: c.bg }}
    >
      <View style={[styles.head, { paddingTop: 18 + (Platform.OS === 'android' ? insets.top : 0) }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel={t('cancel')}>
          <X size={24} color={c.ink2} />
        </Pressable>
        <Txt variant="title">{t('ai.dump.title')}</Txt>
        <View style={{ width: 24 }} />
      </View>
      {drafts === null ? (
        <View style={{ flex: 1, padding: 20, gap: 12 }}>
          <TextInput
            autoFocus
            multiline
            value={text}
            onChangeText={setText}
            placeholder={t('ai.dump.placeholder')}
            placeholderTextColor={c.ink3}
            style={[styles.text, { color: c.ink, backgroundColor: c.surface, borderColor: c.line }]}
          />
          <Txt variant="meta" style={{ paddingHorizontal: 4 }}>
            {zh ? '可以用键盘上的麦克风直接口述。' : 'Tip: use the keyboard’s microphone to dictate.'}
          </Txt>
          {error ? (
            <Txt variant="meta" tone={c.p1} style={{ paddingHorizontal: 4 }}>
              {t('ai.unavailable', { message: error })}
            </Txt>
          ) : null}
          <View style={[styles.actions, { paddingBottom: insets.bottom + 8 }]}>
            <Pressable
              onPress={splitLocally}
              disabled={!text.trim()}
              style={[styles.secondary, { opacity: text.trim() ? 1 : 0.4 }]}
            >
              <Txt tone={c.ink2} style={{ fontSize: 15 }}>
                {zh ? '不用 AI，按句拆分' : 'Split by sentence'}
              </Txt>
            </Pressable>
            <Pressable
              onPress={extract}
              disabled={!text.trim()}
              style={[styles.primary, { backgroundColor: c.jade, opacity: text.trim() ? 1 : 0.4 }]}
            >
              <Sparkles size={17} color={c.jadeInk} />
              <Txt style={{ color: c.jadeInk, fontWeight: '600' }}>{t('ai.dump.extract')}</Txt>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
            {drafts.map((d) => {
              const input = draftToTask(getReplica(), d.data);
              return (
                <Animated.View key={d.key} entering={FadeInDown.duration(220)}>
                  <Pressable
                    onPress={() =>
                      setDrafts(
                        (xs) => xs?.map((x) => (x.key === d.key ? { ...x, include: !x.include } : x)) ?? null,
                      )
                    }
                    style={[
                      styles.card,
                      {
                        borderColor: d.include ? c.jadeLine : c.line,
                        backgroundColor: d.include ? c.jadeSoft : 'transparent',
                        opacity: d.include ? 1 : 0.5,
                      },
                    ]}
                  >
                    <Txt style={{ fontSize: 16, fontWeight: '600' }}>{d.data.title}</Txt>
                    {input.scheduled ? (
                      <Txt variant="meta" tone={c.jade} style={{ marginTop: 4, fontWeight: '500' }}>
                        {formatScheduled(input.scheduled, today)}
                        {input.recurrence
                          ? ` · ${describeRecurrence({ rule: input.recurrence.rule, from: input.recurrence.from ?? 'scheduled' })}`
                          : ''}
                      </Txt>
                    ) : null}
                    {d.data.project ? (
                      <Txt variant="meta" style={{ marginTop: 2 }}>
                        #{d.data.project}
                      </Txt>
                    ) : null}
                  </Pressable>
                </Animated.View>
              );
            })}
            {busy ? (
              <View style={[styles.card, styles.loading, { borderColor: c.jadeLine }]}>
                <ActivityIndicator color={c.jade} />
                <Txt variant="meta">{t('ai.dump.extracting')}</Txt>
              </View>
            ) : null}
            {!busy && !drafts.length ? (
              <Txt variant="meta" style={{ textAlign: 'center', padding: 30 }}>
                {t('ai.dump.empty')}
              </Txt>
            ) : null}
          </ScrollView>
          <View style={[styles.actions, { paddingHorizontal: 20, paddingBottom: insets.bottom + 12 }]}>
            <Pressable onPress={() => setDrafts(null)} style={styles.secondary}>
              <Txt tone={c.ink2}>{t('ai.dump.again')}</Txt>
            </Pressable>
            <Pressable
              onPress={add}
              disabled={busy || !included}
              style={[styles.primary, { backgroundColor: c.jade, opacity: busy || !included ? 0.4 : 1 }]}
            >
              <Txt style={{ color: c.jadeInk, fontWeight: '600' }}>
                {included === drafts.length
                  ? t('ai.dump.addAll', { n: included })
                  : t('ai.dump.addSelected', { n: included })}
              </Txt>
            </Pressable>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  text: {
    flex: 1,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth * 2,
    padding: 14,
    fontSize: 17,
    lineHeight: 25,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  primary: {
    flexDirection: 'row',
    gap: 8,
    height: 48,
    paddingHorizontal: 20,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: { height: 48, justifyContent: 'center', paddingHorizontal: 4 },
  card: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 14, padding: 14 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
