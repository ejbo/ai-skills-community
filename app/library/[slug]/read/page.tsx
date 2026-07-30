import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/admin';
import { getDocReaderData } from '@/lib/library-queries';
import { ReaderShell } from '@/components/library/reader/ReaderShell';
import './reader.css';

export const dynamic = 'force-dynamic';

interface SearchParams {
  ch?: string;
  chat?: string;
  hl?: string;
  view?: string;
}

export default async function LibraryReaderPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: SearchParams;
}) {
  const session = await requireUser();

  // Negative sentinel = resume from saved progress (getDocReaderData clamps).
  // Number('') is 0, so an empty/whitespace ?ch= must fall through to resume
  // rather than silently opening chapter 0.
  const chRaw = typeof searchParams.ch === 'string' ? searchParams.ch.trim() : '';
  const requested = chRaw ? Number(chRaw) : Number.NaN;
  const view =
    searchParams.view === 'flow' ? 'flow' : searchParams.view === 'paged' ? 'paged' : undefined;
  const data = await getDocReaderData(
    params.slug,
    { id: session.user.id, isAdmin: session.user.isAdmin },
    Number.isFinite(requested) ? Math.trunc(requested) : -1,
    view,
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
    />
  );
}
