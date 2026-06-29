import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { resolveActor } from '@/lib/auth/either';
import { logAdmin } from '@/lib/audit';
import { notifyAccessDecision } from '@/lib/notifications';

const schema = z.object({
  action: z.enum(['approve', 'reject', 'revoke']),
  note: z.string().max(500).optional(),
});

const STATUS = { approve: 'approved', reject: 'rejected', revoke: 'revoked' } as const;

/** Owner or admin approves / rejects / revokes a download access request. */
export async function POST(req: Request, { params }: { params: { slug: string; id: string } }) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const reqRow = await prisma.skillAccessRequest.findUnique({
    where: { id: params.id },
    include: {
      skill: { select: { id: true, slug: true, name: true, authorId: true } },
      user: { select: { id: true, email: true, displayName: true } },
    },
  });
  if (!reqRow || reqRow.skill.slug !== params.slug) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const isOwner = reqRow.skill.authorId === actor.id;
  const isAdmin = Boolean(actor.isAdmin);
  if (!isOwner && !isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const newStatus = STATUS[parsed.data.action];
  await prisma.skillAccessRequest.update({
    where: { id: reqRow.id },
    data: {
      status: newStatus,
      decidedById: actor.id,
      decidedAt: new Date(),
      decisionNote: parsed.data.note ?? null,
    },
  });

  if (isAdmin && !isOwner) {
    await logAdmin({
      adminUserId: actor.id,
      action: 'decide_access_request',
      targetType: 'skill',
      targetId: reqRow.skill.slug,
      details: { requestId: reqRow.id, applicantId: reqRow.userId, action: parsed.data.action },
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    });
  }

  await notifyAccessDecision({
    applicantId: reqRow.userId,
    applicantEmail: reqRow.user.email,
    actorId: actor.id,
    skillName: reqRow.skill.name,
    slug: reqRow.skill.slug,
    action: parsed.data.action,
    note: parsed.data.note,
  });

  return NextResponse.json({ ok: true, status: newStatus });
}
