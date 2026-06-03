import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { compareSemver } from '@/lib/version';

const schema = z.object({ action: z.enum(['set_current', 'yank', 'restore']) });

async function loadOwned(slug: string, userId: string, isAdmin: boolean) {
  const skill = await prisma.skill.findUnique({
    where: { slug },
    include: { versions: true },
  });
  if (!skill || skill.deletedAt) return null;
  if (skill.authorId !== userId && !isAdmin) return 'forbidden' as const;
  return skill;
}

// Owner/admin version operations: make a version current, yank it, or restore it.
export async function PATCH(
  req: Request,
  { params }: { params: { slug: string; versionId: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const owned = await loadOwned(params.slug, session.user.id, Boolean(session.user.isAdmin));
  if (owned === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (owned === 'forbidden') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const target = owned.versions.find((v) => v.id === params.versionId);
  if (!target) return NextResponse.json({ error: 'version_not_found' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const { action } = parsed.data;

  if (action === 'set_current') {
    await prisma.$transaction([
      prisma.skillVersion.update({
        where: { id: target.id },
        data: {
          status: 'published',
          publishedAt: target.publishedAt ?? new Date(),
        },
      }),
      prisma.skill.update({
        where: { id: owned.id },
        data: {
          currentVersionId: target.id,
          skillFormat: 'bundle',
          tokenCostEstimate: target.tokenCost,
        },
      }),
    ]);
    return NextResponse.json({ ok: true });
  }

  if (action === 'restore') {
    await prisma.skillVersion.update({ where: { id: target.id }, data: { status: 'published' } });
    return NextResponse.json({ ok: true });
  }

  // yank: mark yanked. If it was the current version, fall back to the highest
  // remaining published version (or null when none remain).
  const wasCurrent = owned.currentVersionId === target.id;
  let fallbackId: string | null = owned.currentVersionId;
  if (wasCurrent) {
    const candidates = owned.versions
      .filter((v) => v.id !== target.id && v.status === 'published')
      .sort((a, b) => compareSemver(a, b));
    fallbackId = candidates.length > 0 ? candidates[candidates.length - 1].id : null;
  }
  await prisma.$transaction([
    prisma.skillVersion.update({ where: { id: target.id }, data: { status: 'yanked' } }),
    ...(wasCurrent
      ? [prisma.skill.update({ where: { id: owned.id }, data: { currentVersionId: fallbackId } })]
      : []),
  ]);
  return NextResponse.json({ ok: true, current: fallbackId });
}
