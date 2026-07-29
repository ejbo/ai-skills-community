import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { reprocessDoc } from '@/lib/library/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

// POST /api/library/docs/[id]/reprocess (uploader or admin) — re-runs extraction
// from the stored file / source URL. Fire-and-forget; the UI polls the status route.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const doc = await prisma.libraryDoc.findUnique({
    where: { id: params.id },
    select: { id: true, uploaderId: true, deletedAt: true },
  });
  if (!doc || (doc.deletedAt && !session.user.isAdmin)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (doc.uploaderId !== session.user.id && !session.user.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const gate = rateLimit(`library:reprocess:${session.user.id}`, 6, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: '操作过于频繁，请稍后再试' },
      { status: 429 },
    );
  }

  // Flip the row to processing before responding so the panel shows progress
  // immediately; reprocessDoc records success/failure on the row itself.
  await prisma.libraryDoc.update({
    where: { id: doc.id },
    data: { status: 'processing', processingError: null },
  });
  void reprocessDoc(doc.id).catch((e: unknown) =>
    console.error('[library] reprocess failed', e),
  );

  return NextResponse.json({ ok: true });
}
