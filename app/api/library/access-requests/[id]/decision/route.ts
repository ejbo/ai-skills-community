import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { logAdmin } from '@/lib/audit';
import { notifyLibraryAccessDecision } from '@/lib/notifications';

const schema = z.object({
  decision: z.enum(['approved', 'rejected', 'revoked']),
  note: z.string().trim().max(500).optional(),
});

// POST /api/library/access-requests/[id]/decision (doc uploader or admin).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const request = await prisma.libraryAccessRequest.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      userId: true,
      status: true,
      doc: { select: { id: true, slug: true, title: true, uploaderId: true, deletedAt: true } },
    },
  });
  if (!request || request.doc.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const isUploader = request.doc.uploaderId === session.user.id;
  if (!isUploader && !can(session.user, 'library')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { decision, note } = parsed.data;
  // revoke only makes sense on an approved grant; approve/reject on pending.
  const validFrom = decision === 'revoked' ? ['approved'] : ['pending'];
  if (!validFrom.includes(request.status)) {
    return NextResponse.json({ error: 'invalid_input', reason: '该申请状态已变化' }, { status: 409 });
  }

  await prisma.libraryAccessRequest.update({
    where: { id: request.id },
    data: {
      status: decision,
      decidedById: session.user.id,
      decidedAt: new Date(),
      decisionNote: note || null,
    },
  });

  if (decision !== 'revoked') {
    void notifyLibraryAccessDecision({
      recipientId: request.userId,
      actorId: session.user.id,
      docSlug: request.doc.slug,
      docTitle: request.doc.title,
      approved: decision === 'approved',
    }).catch(() => undefined);
  }

  if (!isUploader) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'decide_library_access',
      targetType: 'library_access_request',
      targetId: request.id,
      details: { decision, docId: request.doc.id },
    });
  }
  return NextResponse.json({ ok: true, status: decision });
}
