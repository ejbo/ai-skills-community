import { notFound, redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { requireUser } from '@/lib/admin';
import { loginHref, selfHref } from '@/lib/auth/callback-path';
import { getDocReaderData, libraryViewerFromSession } from '@/lib/library-queries';
import { can } from '@/lib/permissions';
import { ReaderShell } from '@/components/library/reader/ReaderShell';
import './reader.css';

export const dynamic = 'force-dynamic';

// A type alias, not an interface: only aliases get TypeScript's implicit index
// signature, which is what lets this be passed to selfHref(base, searchParams).
type SearchParams = {
  ch?: string;
  chat?: string;
  hl?: string;
  view?: string;
};

export default async function LibraryReaderPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: SearchParams;
}) {
  const self = selfHref(`/library/${params.slug}/read`, searchParams);
  const session = await requireUser(self);
  const viewer = libraryViewerFromSession(session);
  if (!viewer) redirect(loginHref(self));

  // Negative sentinel = resume from saved progress (getDocReaderData clamps).
  // Number('') is 0, so an empty/whitespace ?ch= must fall through to resume
  // rather than silently opening chapter 0.
  const chRaw = typeof searchParams.ch === 'string' ? searchParams.ch.trim() : '';
  const requested = chRaw ? Number(chRaw) : Number.NaN;
  const view =
    searchParams.view === 'flow' ? 'flow' : searchParams.view === 'paged' ? 'paged' : undefined;
  const data = await getDocReaderData(
    params.slug,
    viewer,
    Number.isFinite(requested) ? Math.trunc(requested) : -1,
    view,
    await getLocale(),
  );
  // Restricted/private doc without an approved grant → the detail page hosts
  // the 申请阅读 flow.
  if (data === 'no_access') redirect(`/library/${params.slug}`);
  if (!data) notFound();

  return (
    <ReaderShell
      doc={data.doc}
      mode={data.mode}
      flowAvailable={data.flowAvailable}
      chapters={data.chapters}
      initialChapter={data.initialChapter}
      toc={data.toc}
      progress={data.progress}
      highlights={data.highlights.map((h) => ({ ...h, createdAt: h.createdAt.toISOString() }))}
      initialChat={
        typeof searchParams.chat === 'string' && searchParams.chat
          ? searchParams.chat.slice(0, 500)
          : null
      }
      focusHighlightId={
        typeof searchParams.hl === 'string' && searchParams.hl ? searchParams.hl : null
      }
      currentUser={{
        id: session.user.id,
        handle: session.user.handle,
        canModerate: can(session.user, 'library'),
      }}
    />
  );
}
