import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { resolveActor } from '@/lib/auth/either';
import { notifyAccessRequest } from '@/lib/notifications';

const schema = z.object({ message: z.string().max(500).optional() });

/** Applicant requests (or re-requests) download access to a restricted skill. */
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const skill = await prisma.skill.findUnique({
    where: { slug: params.slug },
    select: {
      id: true,
      slug: true,
      name: true,
      authorId: true,
      visibility: true,
      status: true,
      deletedAt: true,
      author: { select: { email: true } },
    },
  });
  if (!skill || skill.deletedAt || skill.status !== 'published') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (skill.visibility !== 'restricted') {
    return NextResponse.json({ error: 'not_restricted' }, { status: 400 });
  }
  if (skill.authorId === actor.id) {
    return NextResponse.json({ error: 'own_skill' }, { status: 400 });
  }

  const existing = await prisma.skillAccessRequest.findUnique({
    where: { skillId_userId: { skillId: skill.id, userId: actor.id } },
    select: { status: true },
  });
  if (existing && (existing.status === 'pending' || existing.status === 'approved')) {
    return NextResponse.json({ error: `already_${existing.status}`, status: existing.status }, { status: 409 });
  }

  const request = await prisma.skillAccessRequest.upsert({
    where: { skillId_userId: { skillId: skill.id, userId: actor.id } },
    update: {
      status: 'pending',
      message: parsed.data.message ?? null,
      decidedById: null,
      decidedAt: null,
      decisionNote: null,
    },
    create: {
      skillId: skill.id,
      userId: actor.id,
      status: 'pending',
      message: parsed.data.message ?? null,
    },
  });

  await notifyAccessRequest({
    authorId: skill.authorId,
    authorEmail: skill.author.email,
    actorId: actor.id,
    applicantName: actor.displayName,
    applicantEmail: actor.email,
    skillName: skill.name,
    slug: skill.slug,
    message: parsed.data.message,
  });

  return NextResponse.json({ ok: true, status: 'pending', id: request.id });
}
