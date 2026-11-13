import { t } from '@ai-todo/shared';
import { Stack } from 'expo-router';
import { TrashList } from '../components/TrashList';

export default function TrashScreen() {
  return (
    <>
      <Stack.Screen options={{ title: t('nav.trash') }} />
      <TrashList />
    </>
  );
}
