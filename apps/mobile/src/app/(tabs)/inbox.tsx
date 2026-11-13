import { inbox } from '@ai-todo/core';
import { t } from '@ai-todo/shared';
import { Screen } from '../../components/Screen';
import { TaskTree } from '../../components/TaskTree';
import { Empty } from '../../components/ui';
import { useQuery, useToday } from '../../state/replica';

export default function InboxScreen() {
  const today = useToday();
  const tasks = useQuery((s) => inbox(s));
  return (
    <Screen title={t('nav.inbox')}>
      <TaskTree tasks={tasks} today={today} />
      {!tasks.length && <Empty title={t('inbox.empty.title')} body={t('inbox.empty.body')} />}
    </Screen>
  );
}
