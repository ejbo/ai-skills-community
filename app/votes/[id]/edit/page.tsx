import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { getVoteActivityForEdit, voteViewerFromSession } from '@/lib/vote-queries';
import { voteHref } from '@/lib/votes/shared';
import { resolveVoteParam } from '@/lib/votes/slug';
import { VoteEditor } from '../../_components/VoteEditor';
import { loginHref } from '@/lib/auth/callback-path';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getTranslations('votes');
  return { title: t('ed_title') };
}

// Slug OR id, like the detail page; the ownership gate runs before the canonical redirect.
export default async function VoteEditPage({ params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) {
    redirect(loginHref(`/votes/${params.id}/edit`));
  }
  const ref = await resolveVoteParam(params.id);
  if (!ref) notFound();
  const edit = await getVoteActivityForEdit(ref.id, voteViewerFromSession(session));
  if (!edit) notFound();
  if (!ref.canonical) permanentRedirect(voteHref(edit, 'edit'));

  return (
    <div className="container max-w-5xl py-8">
      <VoteEditor initial={edit} />
    </div>
  );
}
