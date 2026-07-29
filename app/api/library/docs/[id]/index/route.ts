import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { runDocIndexing } from '@/lib/library/indexer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

// POST /api/library/docs/[id]/index (login) — (re)run the one-time AI reading
// (per-chapter summaries + 导读). Any user may trigger it; the result is cached
// on the row and shared by everyone.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`library:index:${session.user.id}`, 6, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: '操作过于频繁，请稍后再试' },
      { status: 429 },
    );
  }

  const doc = await prisma.libraryDoc.findUnique({
    where: { id: params.id },
    select: { id: true, status: true, aiIndexState: true, deletedAt: true },
  });
  if (!doc || doc.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (doc.status !== 'ready') {
    return NextResponse.json(
      { error: 'not_ready', reason: '文档尚未处理完成' },
      { status: 409 },
    );
  }
  if (doc.aiIndexState === 'running') {
    return NextResponse.json(
      { error: 'already_running', reason: 'AI 正在阅读本文档' },
      { status: 409 },
    );
  }

  void runDocIndexing(doc.id, { force: true }).catch((e) =>
    console.error('[library] indexing failed', e),
  );

  return NextResponse.json({ ok: true });
}
