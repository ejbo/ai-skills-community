import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { BackButton } from '@/components/BackButton';
import { TopicForm } from '../../../_components/TopicForm';

export const dynamic = 'force-dynamic';

export default async function EditTopicPage({ params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) redirect('/auth/login');

  const topic = await prisma.discussionTopic.findUnique({
    where: { id: params.id },
    select: { id: true, authorId: true, title: true, bodyMd: true, category: true },
  });
  if (!topic) notFound();
  // Content edits are author-only (the PATCH route enforces the same rule).
  if (topic.authorId !== session.user.id) redirect(`/discussion/topics/${topic.id}`);

  return (
    <div className="container max-w-3xl py-8">
      <div className="mb-5">
        <BackButton fallbackHref={`/discussion/topics/${topic.id}`} />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">编辑帖子</h1>
      <div className="mt-5">
        <TopicForm
          topicId={topic.id}
          initialTitle={topic.title}
          initialBodyMd={topic.bodyMd}
          initialCategory={topic.category}
        />
      </div>
    </div>
  );
}
