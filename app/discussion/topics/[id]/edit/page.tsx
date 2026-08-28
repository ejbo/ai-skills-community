import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { loginHref } from '@/lib/auth/callback-path';
import { prisma } from '@/lib/db';
import { BackButton } from '@/components/BackButton';
import { listOfficialDiscussionTags, resolveTagViews } from '@/lib/discussion-queries';
import { TopicForm } from '../../../_components/TopicForm';
import type { MediaDraft, UploadedItem } from '../../../_components/MediaPicker';

export const dynamic = 'force-dynamic';

export default async function EditTopicPage({ params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) redirect(loginHref(`/discussion/topics/${params.id}/edit`));

  const topic = await prisma.discussionTopic.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      authorId: true,
      title: true,
      bodyMd: true,
      categories: true,
      media: {
        orderBy: { sortOrder: 'asc' },
        select: { kind: true, key: true, url: true, name: true, mimeType: true, sizeBytes: true },
      },
    },
  });
  if (!topic) notFound();
  // Content edits are author-only (the PATCH route enforces the same rule).
  if (topic.authorId !== session.user.id) redirect(`/discussion/topics/${topic.id}`);
  const [t, officialTags, initialTagViews] = await Promise.all([
    getTranslations('discussion_pages'),
    listOfficialDiscussionTags(),
    resolveTagViews(topic.categories),
  ]);

  const toItem = (m: (typeof topic.media)[number]): UploadedItem => ({
    key: m.key,
    url: m.url,
    name: m.name,
    mimeType: m.mimeType,
    sizeBytes: m.sizeBytes,
  });
  const initialMedia: MediaDraft = {
    images: topic.media.filter((m) => m.kind === 'image').map(toItem),
    video: topic.media.filter((m) => m.kind === 'video').map(toItem)[0] ?? null,
    videoLink: topic.media.find((m) => m.kind === 'video_link')?.url ?? '',
    files: topic.media.filter((m) => m.kind === 'file').map(toItem),
  };

  return (
    <div className="container max-w-3xl py-8">
      <div className="mb-5">
        <BackButton fallbackHref={`/discussion/topics/${topic.id}`} />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{t('edit_topic_title')}</h1>
      <div className="mt-5">
        <TopicForm
          topicId={topic.id}
          officialTags={officialTags}
          initialTagViews={initialTagViews}
          initialTitle={topic.title}
          initialBodyMd={topic.bodyMd}
          initialCategories={topic.categories}
          initialMedia={initialMedia}
        />
      </div>
    </div>
  );
}
