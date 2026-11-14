import { summarize, type VoiceRecord } from '@ai-todo/core';
import { type MessageKey, t } from '@ai-todo/shared';
import { router } from 'expo-router';
import { Play } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../components/ui';
import {
  audioFile,
  clearJournal,
  exportJournal,
  getJournal,
  setJournalEnabled,
  useJournal,
} from '../state/journal';
import { useColors } from '../theme';

/** Settings → Voice log: the round-1 numbers and what was said, newest first. */
export default function VoiceLogScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const enabled = useJournal((s) => s.enabled);
  const records = useJournal((s) => s.records);
  // Load the file the first time the screen opens.
  useMemo(() => getJournal(), []);
  const summary = useMemo(() => summarize(records), [records]);
  const recent = useMemo(() => [...records].reverse().slice(0, 150), [records]);
  const sec = (ms: number) => (ms / 1000).toFixed(1);
  const latency = summary.firstChange ?? summary.done;

  const clear = () =>
    Alert.alert(t('voiceLog.clear'), t('voiceLog.clearConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('voiceLog.clear'), style: 'destructive', onPress: clearJournal },
    ]);

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{
        paddingTop: 20 + (Platform.OS === 'android' ? insets.top : 0),
        paddingBottom: insets.bottom + 40,
      }}
    >
      <View style={styles.head}>
        <Txt variant="large">{t('voiceLog.title')}</Txt>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Txt tone={c.jade} style={{ fontWeight: '600' }}>
            {t('done')}
          </Txt>
        </Pressable>
      </View>
      <View style={{ paddingHorizontal: 16, gap: 10, marginTop: 16 }}>
        <Txt variant="meta" style={styles.help}>
          {t('voiceLog.help')}
        </Txt>
        <View style={[styles.row, { backgroundColor: c.surface, borderColor: c.line }]}>
          <Txt style={{ flex: 1 }}>{t('voiceLog.keep')}</Txt>
          <Switch value={enabled} onValueChange={setJournalEnabled} trackColor={{ true: c.jade }} />
        </View>
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }]}>
          <Stat label={t('voiceLog.count', { n: summary.count })} value="" />
          <Stat
            label={t('voiceLog.latency')}
            value={
              latency ? t('voiceLog.latencyValue', { p50: sec(latency.p50), p90: sec(latency.p90) }) : '—'
            }
          />
          <Stat
            label={t('voiceLog.undoRate')}
            value={
              summary.applied
                ? t('voiceLog.undoValue', {
                    undone: summary.undone,
                    applied: summary.applied,
                    pct: Math.round((summary.undone / summary.applied) * 100),
                  })
                : '—'
            }
          />
          <Stat
            label={t('voiceLog.judged')}
            value={
              summary.judged || summary.misheard
                ? t('voiceLog.judgedValue', {
                    right: summary.right,
                    judged: summary.judged,
                    misheard: summary.misheard,
                  })
                : '—'
            }
          />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
            <Btn
              label={t('voiceLog.export')}
              onPress={() => void exportJournal()}
              disabled={!records.length}
            />
            <Btn label={t('voiceLog.clear')} onPress={clear} disabled={!records.length} danger />
          </View>
        </View>
        <Txt variant="meta" style={[styles.help, { marginTop: 6 }]}>
          {recent.length ? t('voiceLog.labelHelp') : t('voiceLog.empty')}
        </Txt>
        {recent.map((r) => (
          <Entry key={r.id} record={r} />
        ))}
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Txt style={{ fontWeight: '600' }}>{label}</Txt>
      <Txt tone={c.ink2}>{value}</Txt>
    </View>
  );
}

function Btn({
  label,
  onPress,
  disabled,
  danger,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.btn, { backgroundColor: c.hover, opacity: disabled ? 0.45 : 1 }]}
    >
      <Txt style={{ color: danger ? c.p1 : c.ink, fontWeight: '600', fontSize: 15 }}>{label}</Txt>
    </Pressable>
  );
}

function Entry({ record: r }: { record: VoiceRecord }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState(r.label?.said ?? r.heard);
  const d = new Date(r.at);
  const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
  const how = !r.capture
    ? t('voiceLog.typed')
    : r.capture.mode === 'cloud'
      ? t('voiceLog.cloud')
      : t('voiceLog.system');
  const ms = r.firstChangeMs ?? r.doneMs;
  const audio = r.capture?.audio ? audioFile(r.capture.audio) : null;
  const bad =
    r.label?.ok === false || (r.label?.ok === undefined && (r.status === 'undone' || r.status === 'error'));
  const meta = [
    when,
    how,
    t(`voiceLog.status.${r.status}` as MessageKey),
    ms !== undefined ? t('voiceLog.seconds', { s: (ms / 1000).toFixed(1) }) : '',
    r.label?.ok === true
      ? `✓ ${t('voiceLog.right')}`
      : r.label?.ok === false
        ? `✗ ${t('voiceLog.wrong')}`
        : '',
    r.label?.said ? t('voiceLog.misheard') : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const misheard = r.capture?.system && r.capture.system !== r.heard ? r.capture.system : '';
  const judge = (ok: boolean) => getJournal().label(r.id, { ok: r.label?.ok === ok ? null : ok });
  return (
    <Pressable
      onPress={() => setOpen((o) => !o)}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      style={[styles.entry, { backgroundColor: c.surface, borderColor: bad ? c.p1 : c.line }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Txt variant="meta" style={{ flex: 1 }} tone={bad ? c.p1 : undefined}>
          {meta}
        </Txt>
        {audio ? (
          <Pressable
            onPress={() => void audio.preview().catch(() => undefined)}
            hitSlop={10}
            accessibilityLabel={t('voiceLog.play')}
          >
            <Play size={16} color={c.jade} />
          </Pressable>
        ) : null}
      </View>
      <Txt style={{ fontWeight: '600' }}>{r.heard}</Txt>
      {misheard ? (
        <Txt variant="meta">
          {t('voiceLog.system')}：{misheard}
        </Txt>
      ) : null}
      {r.changes.length ? (
        <Txt variant="meta" numberOfLines={3}>
          {r.changes.map((ch) => `${changeLabel(ch.kind)} ${ch.title}`).join(' · ')}
        </Txt>
      ) : null}
      {r.reply || r.error ? (
        <Txt variant="meta" tone={c.ink2} numberOfLines={open ? undefined : 3}>
          {r.error ?? r.reply}
        </Txt>
      ) : null}
      {r.label?.said && !open ? (
        <Txt variant="meta" tone={c.jade}>
          {t('voiceLog.said')}：{r.label.said}
        </Txt>
      ) : null}
      {open ? (
        <View style={{ gap: 8, marginTop: 8 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Choice
              label={`✓ ${t('voiceLog.right')}`}
              on={r.label?.ok === true}
              onPress={() => judge(true)}
            />
            <Choice
              label={`✗ ${t('voiceLog.wrong')}`}
              on={r.label?.ok === false}
              onPress={() => judge(false)}
            />
          </View>
          <Txt variant="meta">{t('voiceLog.said')}</Txt>
          <TextInput
            value={said}
            onChangeText={setSaid}
            onEndEditing={() => getJournal().label(r.id, { said })}
            multiline
            accessibilityLabel={t('voiceLog.said')}
            style={[styles.said, { color: c.ink, borderColor: c.line, backgroundColor: c.bg }]}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

function Choice({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={[styles.btn, { backgroundColor: on ? c.jade : c.hover }]}
    >
      <Txt style={{ color: on ? c.jadeInk : c.ink, fontWeight: '600', fontSize: 15 }}>{label}</Txt>
    </Pressable>
  );
}

function changeLabel(kind: string): string {
  const key = `change.${kind}` as MessageKey;
  const s = t(key);
  return s === key ? kind : s;
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  help: { paddingHorizontal: 8, fontSize: 13.5, lineHeight: 19 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  card: { padding: 16, gap: 8, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  btn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entry: { padding: 14, gap: 4, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  said: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
});
