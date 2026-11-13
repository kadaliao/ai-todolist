import { search } from '@ai-todo/core';
import { t } from '@ai-todo/shared';
import { router } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TaskRow } from '../components/TaskRow';
import { Txt } from '../components/ui';
import { useQuery, useToday } from '../state/replica';
import { readable, useColors } from '../theme';

export default function SearchScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const today = useToday();
  const [q, setQ] = useState('');
  const results = useQuery((s) => (q.trim() ? search(s, q, 80) : []), [q]);
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 8 }}>
      <View style={styles.bar}>
        <View style={[styles.field, { backgroundColor: c.hover }]}>
          <Search size={18} color={c.ink3} />
          <TextInput
            autoFocus
            value={q}
            onChangeText={setQ}
            placeholder={t('search.placeholder')}
            placeholderTextColor={c.ink3}
            returnKeyType="search"
            clearButtonMode="while-editing"
            style={{ flex: 1, fontSize: 17, color: c.ink }}
          />
        </View>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Txt tone={c.jade} style={{ fontWeight: '500' }}>
            {t('cancel')}
          </Txt>
        </Pressable>
      </View>
      <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={[readable, { paddingBottom: 60 }]}>
        {results.map((task) => (
          <TaskRow key={task.id} task={task} today={today} showProject />
        ))}
        {q.trim() && !results.length ? (
          <Txt variant="meta" style={{ textAlign: 'center', padding: 40, fontSize: 15 }}>
            {t('search.empty', { q })}
          </Txt>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 10 },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 42,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
});
