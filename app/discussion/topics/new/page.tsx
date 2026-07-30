import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/admin';
import { BackButton } from '@/components/BackButton';
import { TopicForm } from '../../_components/TopicForm';

export const dynamic = 'force-dynamic';

export default async function NewTopicPage() {
  await requireUser();
  const t = await getTranslations('discussion_pages');

  return (
    <div className="container max-w-3xl py-8">
      <div className="mb-5">
        <BackButton fallbackHref="/discussion?tab=forum" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{t('start_topic')}</h1>
      <div className="mt-5">
        <TopicForm />
      </div>
    </div>
  );
}
