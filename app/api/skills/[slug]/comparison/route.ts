import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { loadAccessContext } from '@/lib/access';
import { comparisonPutSchema, parseComparisonExample } from '@/lib/comparison';

export const dynamic = 'force-dynamic';

// GET — owner/admin get the full row (draft or published); visitors get the
// published comparison only when they may access the skill's content.
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const { skill, decision } = await loadAccessContext(params.slug, req);
  if (!skill || skill.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const privileged = decision.kind === 'owner' || decision.kind === 'admin';
  const cmp = await prisma.skillComparison.findUnique({ where: { skillId: skill.id } });

  if (privileged) {
    const stale = Boolean(cmp && cmp.generatedForVersionId && cmp.generatedForVersionId !== skill.currentVersionId);
    return NextResponse.json({ comparison: cmp ?? null, privileged: true, stale });
  }

  // Visitor: only a published comparison on an accessible skill is visible.
  const accessible = skill.visibility === 'public' ? true : decision.canContent;
  if (!cmp || cmp.status !== 'published' || skill.status !== 'published' || !accessible) {
    return NextResponse.json({ comparison: null });
  }
  return NextResponse.json({
    comparison: {
      bodyMd: cmp.bodyMd,
      example: cmp.example,
      model: cmp.model,
      updatedAt: cmp.updatedAt,
    },
  });
}

// PUT — owner/admin save (draft) or publish. Publishing requires a body.
export async function PUT(req: Request, { params }: { params: { slug: string } }) {
  const { skill, decision } = await loadAccessContext(params.slug, req);
  if (!skill || skill.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const privileged = decision.kind === 'owner' || decision.kind === 'admin';
  if (!privileged) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = comparisonPutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const { bodyMd, example, guidancePrompt, model, status } = parsed.data;
  if (status === 'published' && (!bodyMd || bodyMd.trim().length === 0)) {
    return NextResponse.json(
      { error: 'empty_body', reason: '发布前请先填写对比正文' },
      { status: 400 },
    );
  }

  // Validate example shape defensively even though zod already checked it, and
  // map to Prisma's JSON input (DbNull clears the column).
  const exampleInput: Prisma.InputJsonValue | typeof Prisma.DbNull | undefined =
    example === undefined
      ? undefined
      : example === null
        ? Prisma.DbNull
        : ((parseComparisonExample(example) as unknown as Prisma.InputJsonValue | null) ?? Prisma.DbNull);

  const data = {
    status,
    ...(bodyMd !== undefined ? { bodyMd } : {}),
    ...(exampleInput !== undefined ? { example: exampleInput } : {}),
    ...(guidancePrompt !== undefined ? { guidancePrompt } : {}),
    ...(model !== undefined ? { model } : {}),
    generatedForVersionId: skill.currentVersionId,
  } satisfies Prisma.SkillComparisonUncheckedUpdateInput;

  const saved = await prisma.skillComparison.upsert({
    where: { skillId: skill.id },
    create: { skillId: skill.id, ...data },
    update: data,
  });
  return NextResponse.json({ comparison: saved });
}

// DELETE — owner/admin remove the comparison entirely.
export async function DELETE(req: Request, { params }: { params: { slug: string } }) {
  const { skill, decision } = await loadAccessContext(params.slug, req);
  if (!skill || skill.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const privileged = decision.kind === 'owner' || decision.kind === 'admin';
  if (!privileged) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await prisma.skillComparison.deleteMany({ where: { skillId: skill.id } });
  return NextResponse.json({ ok: true });
}
