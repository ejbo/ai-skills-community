import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { notifyLibraryAccessRequest } from '@/lib/notifications';

const HOUR_MS = 60 * 60 * 1000;

const schema = z.object({ message: z.string().trim().max(500).optional() });

// GET /api/library/docs/[id]/access-request (uploader/admin) — pending +
// approved requests for the uploader's 审批 panel on the detail page.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const doc = await prisma.libraryDoc.findUnique({
    where: { id: params.id },
    select: { id: true, uploaderId: true, deletedAt: true },
  });
  if (!doc || doc.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (doc.uploaderId !== session.user.id && !session.user.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const requests = await prisma.libraryAccessRequest.findMany({
    where: { docId: doc.id, status: { in: ['pending', 'approved'] } },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      status: true,
      message: true,
      createdAt: true,
      user: { select: { handle: true, displayName: true, avatarUrl: true } },
    },
  });
  return NextResponse.json({ requests });
}

// POST /api/library/docs/[id]/access-request (login) — ask to read a
// restricted doc. Re-applying after a rejection mutates the unique row back
// to pending (skills model).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`library:access:${session.user.id}`, 20, HOUR_MS);
  if (!gate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const doc = await prisma.libraryDoc.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      slug: true,
      title: true,
      uploaderId: true,
      visibility: true,
      status: true,
      deletedAt: true,
    },
  });
  if (!doc || doc.deletedAt || doc.status !== 'ready' || doc.visibility !== 'restricted') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (doc.uploaderId === session.user.id) {
    return NextResponse.json({ error: 'invalid_input', reason: '这是你自己的文档' }, { status: 400 });
  }

  const existing = await prisma.libraryAccessRequest.findUnique({
    where: { docId_userId: { docId: doc.id, userId: session.user.id } },
    select: { id: true, status: true },
  });
  if (existing?.status === 'approved' || existing?.status === 'pending') {
    return NextResponse.json({ ok: true, status: existing.status });
  }

  const request = await prisma.libraryAccessRequest.upsert({
    where: { docId_userId: { docId: doc.id, userId: session.user.id } },
    create: {
      docId: doc.id,
      userId: session.user.id,
      message: parsed.data.message || null,
    },
    update: {
      status: 'pending',
      message: parsed.data.message || null,
      decidedById: null,
      decidedAt: null,
      decisionNote: null,
    },
    select: { id: true, status: true },
  });

  void notifyLibraryAccessRequest({
    recipientId: doc.uploaderId,
    actorId: session.user.id,
    actorName: session.user.displayName,
    docSlug: doc.slug,
    docTitle: doc.title,
    message: parsed.data.message,
  }).catch(() => undefined);

  return NextResponse.json({ ok: true, status: request.status });
}
