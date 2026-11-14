import {
  DAY_PART_NAMES,
  DAY_PARTS_KEY,
  type DayParts,
  dayParts,
  deleteMemory,
  memories,
  setSetting,
} from '@ai-todo/core';
import { t } from '@ai-todo/shared';
import { router } from 'expo-router';
import { X } from 'lucide-react-native';
import { ActionSheetIOS, Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../components/ui';
import { run } from '../state/actions';
import { useQuery } from '../state/replica';
import { useColors } from '../theme';

/** Times offered for each day part (any other is kept if set elsewhere, e.g. by voice). */
const CHOICES: Record<keyof DayParts, string[]> = {
  morning: ['06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00'],
  noon: ['11:00', '11:30', '12:00', '12:30', '13:00'],
  afternoon: ['13:00', '14:00', '14:30', '15:00', '15:30', '16:00', '17:00'],
  evening: ['18:00', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00'],
};

function pick(title: string, options: string[], onPick: (i: number) => void) {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options: [...options, t('cancel')], cancelButtonIndex: options.length },
      (i) => i < options.length && onPick(i),
    );
  } else {
    Alert.alert(title, undefined, [
      ...options.map((text, i) => ({ text, onPress: () => onPick(i) })),
      { text: t('cancel'), style: 'cancel' as const },
    ]);
  }
}

/** Settings → what the assistant remembers, and what 早上 / 晚上 mean. Both sync. */
export default function MemoryScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const list = useQuery((s) => memories(s));
  const parts = useQuery((s) => dayParts(s));
  const setPart = (k: keyof DayParts, v: string) => run(setSetting(DAY_PARTS_KEY, { ...parts, [k]: v }));

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{
        paddingTop: 20 + (Platform.OS === 'android' ? insets.top : 0),
        paddingBottom: insets.bottom + 40,
      }}
    >
      <View style={styles.head}>
        <Txt variant="large">{t('agent.memory')}</Txt>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Txt tone={c.jade} style={{ fontWeight: '600' }}>
            {t('done')}
          </Txt>
        </Pressable>
      </View>
      <View style={styles.body}>
        {list.length ? (
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }]}>
            {list.map((m, i) => (
              <View
                key={m.id}
                style={[
                  styles.item,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
                ]}
              >
                <Txt style={{ flex: 1, fontSize: 16, lineHeight: 22 }}>{m.text}</Txt>
                <Pressable
                  onPress={() => run(deleteMemory(m.id))}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('agent.memory.delete')} ${m.text}`}
                >
                  <X size={18} color={c.ink3} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <Txt variant="label">{t('agent.memory.empty')}</Txt>
        )}
        <Txt variant="meta" style={styles.help}>
          {t('agent.memory.help')}
        </Txt>

        <Txt variant="section" style={{ marginTop: 18 }}>
          {t('dayParts.title')}
        </Txt>
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }]}>
          {DAY_PART_NAMES.map((k, i) => (
            <Pressable
              key={k}
              onPress={() => pick(t(`dayParts.${k}`), CHOICES[k], (j) => setPart(k, CHOICES[k][j] as string))}
              accessibilityRole="button"
              accessibilityLabel={`${t(`dayParts.${k}`)} ${parts[k]}`}
              style={[
                styles.item,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
              ]}
            >
              <Txt style={{ flex: 1, fontSize: 16 }}>{t(`dayParts.${k}`)}</Txt>
              <Txt tone={c.jade} style={{ fontSize: 16, fontVariant: ['tabular-nums'] }}>
                {parts[k]}
              </Txt>
            </Pressable>
          ))}
        </View>
        <Txt variant="meta" style={styles.help}>
          {t('dayParts.help')}
        </Txt>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  body: { paddingHorizontal: 16, gap: 10, marginTop: 16 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  help: { paddingHorizontal: 8, fontSize: 13.5, lineHeight: 19 },
});
