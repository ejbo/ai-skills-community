import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { getVoteActivityView, voteViewerFromSession } from '@/lib/vote-queries';
import { VoteGallery } from '../_components/VoteGallery';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { id: string } }) {
  const session = await auth();
  const view = await getVoteActivityView(params.id, voteViewerFromSession(session));
  if (!view) {
    const t = await getTranslations('votes');
    return { title: t('meta_title') };
  }
  return { title: view.title };
}

export default async function VoteDetailPage({ params }: { params: { id: string } }) {
  const session = await auth();
  const view = await getVoteActivityView(params.id, voteViewerFromSession(session));
  if (!view) notFound();

  return (
    <div className="container max-w-6xl py-8">
      <VoteGallery initial={view} />
    </div>
  );
}
