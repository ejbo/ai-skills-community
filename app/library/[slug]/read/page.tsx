import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/admin';
import { getDocReaderData } from '@/lib/library-queries';
import { ReaderShell } from '@/components/library/reader/ReaderShell';
import './reader.css';

export const dynamic = 'force-dynamic';

interface SearchParams {
  ch?: string;
  chat?: string;
  hl?: string;
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
  const data = await getDocReaderData(
    params.slug,
    session.user.id,
    Number.isFinite(requested) ? Math.trunc(requested) : -1,
  );
  if (!data) notFound();

  return (
    <ReaderShell
      doc={data.doc}
      chapter={data.chapter}
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
