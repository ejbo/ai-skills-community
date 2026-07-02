import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';
import { packInputSchema, checkPackSkills } from '@/lib/pack-admin';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = packInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const existing = await prisma.skillPack.findUnique({ where: { slug: parsed.data.slug } });
  if (existing) return NextResponse.json({ error: 'slug_taken' }, { status: 409 });

  const skills = await checkPackSkills(parsed.data.skillIds);
  if (!skills.ok) {
    return NextResponse.json(
      { error: 'invalid_skills', reason: '包含未发布/私密/已删除的 skill', bad: skills.bad },
      { status: 400 },
    );
  }

  const { skillIds: _ignored, ...fields } = parsed.data;
  const created = await prisma.skillPack.create({
    data: {
      ...fields,
      createdById: session.user.id,
      items: {
        create: skills.ids.map((skillId, i) => ({ skillId, sortOrder: i })),
      },
    },
  });

  await logAdmin({
    adminUserId: session.user.id,
    action: 'create_pack',
    targetType: 'skill_pack',
    targetId: created.id,
    details: { slug: created.slug, name: created.name, skillCount: skills.ids.length },
  });

  return NextResponse.json({ ok: true, pack: created });
}
