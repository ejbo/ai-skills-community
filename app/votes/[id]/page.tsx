import { notFound, permanentRedirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { getVoteActivityView, voteViewerFromSession } from '@/lib/vote-queries';
import { voteHref } from '@/lib/votes/shared';
import { resolveVoteParam } from '@/lib/votes/slug';
import { VoteGallery } from '../_components/VoteGallery';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

/** `?a=1&b=2` of the incoming request, kept across the canonical-slug redirect. */
function queryOf(searchParams: SearchParams): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) qs.append(k, one);
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export async function generateMetadata({ params }: { params: { id: string } }) {
  const session = await auth();
  const ref = await resolveVoteParam(params.id);
  const view = ref ? await getVoteActivityView(ref.id, voteViewerFromSession(session)) : null;
  if (!view) {
    const t = await getTranslations('votes');
    return { title: t('meta_title') };
  }
  return { title: view.title };
}

// `[id]` is a title slug OR the row id (docs/contracts/slugs.md). The visibility gate
// runs BEFORE the canonical redirect — redirecting first would hand the slug (= the
// title) of a hidden activity to anyone holding its id.
export default async function VoteDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: SearchParams;
}) {
  const session = await auth();
  const ref = await resolveVoteParam(params.id);
  if (!ref) notFound();
  const view = await getVoteActivityView(ref.id, voteViewerFromSession(session));
  if (!view) notFound();
  if (!ref.canonical) permanentRedirect(`${voteHref(view)}${queryOf(searchParams)}`);

  return (
    <div className="container max-w-6xl py-8">
      <VoteGallery initial={view} />
    </div>
  );
}
