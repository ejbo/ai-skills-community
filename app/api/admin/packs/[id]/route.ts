import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';
import { packUpdateSchema, checkPackSkills } from '@/lib/pack-admin';

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = packUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const before = await prisma.skillPack.findUnique({
    where: { id: params.id },
    include: { _count: { select: { items: true } } },
  });
  if (!before) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { skillIds, ...fields } = parsed.data;

  let memberIds: string[] | null = null;
  if (skillIds) {
    const skills = await checkPackSkills(skillIds);
    if (!skills.ok) {
      return NextResponse.json(
        { error: 'invalid_skills', reason: '包含未发布/私密/已删除的 skill', bad: skills.bad },
        { status: 400 },
      );
    }
    memberIds = skills.ids;
  }

  // Replace membership atomically with the field update so a failed item write
  // can't leave the pack half-edited.
  const updated = await prisma.$transaction(async (tx) => {
    if (memberIds) {
      await tx.skillPackItem.deleteMany({ where: { packId: params.id } });
      if (memberIds.length > 0) {
        await tx.skillPackItem.createMany({
          data: memberIds.map((skillId, i) => ({ packId: params.id, skillId, sortOrder: i })),
        });
      }
    }
    return tx.skillPack.update({ where: { id: params.id }, data: fields });
  });

  await logAdmin({
    adminUserId: session.user.id,
    action: 'update_pack',
    targetType: 'skill_pack',
    targetId: params.id,
    details: {
      before: {
        name: before.name,
        summary: before.summary,
        isPublished: before.isPublished,
        sortOrder: before.sortOrder,
        skillCount: before._count.items,
      },
      after: { ...fields, skillCount: memberIds?.length ?? before._count.items },
    },
  });

  return NextResponse.json({ ok: true, pack: updated });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const before = await prisma.skillPack.findUnique({ where: { id: params.id } });
  if (!before) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Items are removed via the packId Cascade rule; member skills are untouched.
  await prisma.skillPack.delete({ where: { id: params.id } });
  await logAdmin({
    adminUserId: session.user.id,
    action: 'delete_pack',
    targetType: 'skill_pack',
    targetId: params.id,
    details: { slug: before.slug, name: before.name },
  });
  return NextResponse.json({ ok: true });
}
