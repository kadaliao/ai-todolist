import { router } from 'expo-router';
import { Search, Settings } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../theme';
import { Press, Txt } from './ui';

/** A tab screen: large title (optionally with the day numeral), search + settings, scrolling body. */
export function Screen({
  title,
  sub,
  numeral,
  children,
  right,
}: {
  title: string;
  sub?: string;
  numeral?: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 4, paddingBottom: 160 }}
      keyboardDismissMode="on-drag"
    >
      <View style={styles.toolbar}>
        {right}
        <Press onPress={() => router.push('/search')} accessibilityLabel="Search">
          <View style={styles.iconBtn}>
            <Search size={22} color={c.ink2} />
          </View>
        </Press>
        <Press onPress={() => router.push('/settings')} accessibilityLabel="Settings">
          <View style={styles.iconBtn}>
            <Settings size={22} color={c.ink2} />
          </View>
        </Press>
      </View>
      <View style={styles.header}>
        {numeral ? (
          <Txt variant="display" accessibilityElementsHidden>
            {numeral}
          </Txt>
        ) : null}
        <View style={{ flex: 1 }}>
          <Txt variant="large" accessibilityRole="header">
            {title}
          </Txt>
          {sub ? (
            <Txt variant="meta" style={{ marginTop: 2, fontSize: 14 }}>
              {sub}
            </Txt>
          ) : null}
        </View>
      </View>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 10,
    height: 44,
    alignItems: 'center',
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingHorizontal: 20, paddingBottom: 16 },
});
