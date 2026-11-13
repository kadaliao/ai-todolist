import { inbox, today as todayView } from '@ai-todo/core';
import { t } from '@ai-todo/shared';
import * as Haptics from 'expo-haptics';
import { router, Tabs } from 'expo-router';
import { CalendarDays, Inbox, LayoutGrid, Plus, Sun } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Press } from '../../components/ui';
import { useQuery, useToday } from '../../state/replica';
import { useColors } from '../../theme';

export default function TabLayout() {
  const c = useColors();
  const today = useToday();
  const insets = useSafeAreaInsets();
  const counts = useQuery(
    (s) => {
      const td = todayView(s, today);
      return {
        today: td.today.length + td.overdue.length,
        overdue: td.overdue.length,
        inbox: inbox(s).length,
      };
    },
    [today],
  );
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: c.jade,
          tabBarInactiveTintColor: c.ink3,
          tabBarStyle: { backgroundColor: c.bg, borderTopColor: c.line },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
          sceneStyle: { backgroundColor: c.bg },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t('nav.today'),
            tabBarIcon: ({ color, size }) => <Sun color={color} size={size} />,
            tabBarBadge: counts.overdue ? counts.overdue : undefined,
            tabBarBadgeStyle: { backgroundColor: c.p1, fontSize: 11 },
          }}
        />
        <Tabs.Screen
          name="inbox"
          options={{
            title: t('nav.inbox'),
            tabBarIcon: ({ color, size }) => <Inbox color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="upcoming"
          options={{
            title: t('nav.upcoming'),
            tabBarIcon: ({ color, size }) => <CalendarDays color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="browse"
          options={{
            title: t('nav.browse'),
            tabBarIcon: ({ color, size }) => <LayoutGrid color={color} size={size} />,
          }}
        />
      </Tabs>
      <View pointerEvents="box-none" style={[styles.fabWrap, { bottom: insets.bottom + 62 }]}>
        <Press
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push('/add');
          }}
          onLongPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            router.push('/dump');
          }}
          accessibilityLabel={t('qa.placeholderShort')}
          accessibilityHint={t('palette.brainDump')}
          scaleTo={0.9}
        >
          <View style={[styles.fab, { backgroundColor: c.jade, shadowColor: c.jade }]}>
            <Plus color={c.jadeInk} size={28} strokeWidth={2.5} />
          </View>
        </Press>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fabWrap: { position: 'absolute', right: 20 },
  fab: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
});
