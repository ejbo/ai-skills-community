import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { getVoteActivityForEdit, voteViewerFromSession } from '@/lib/vote-queries';
import { VoteEditor } from '../../_components/VoteEditor';
import { loginHref } from '@/lib/auth/callback-path';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getTranslations('votes');
  return { title: t('ed_title') };
}

export default async function VoteEditPage({ params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) {
    redirect(loginHref(`/votes/${params.id}/edit`));
  }
  const edit = await getVoteActivityForEdit(params.id, voteViewerFromSession(session));
  if (!edit) notFound();

  return (
    <div className="container max-w-5xl py-8">
      <VoteEditor initial={edit} />
    </div>
  );
}
