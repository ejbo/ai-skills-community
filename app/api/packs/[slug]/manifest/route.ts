import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveActor } from '@/lib/auth/either';
import { INSTALLABLE_SKILL_WHERE } from '@/lib/pack-queries';

export const dynamic = 'force-dynamic';

/**
 * Resolve endpoint for `skills install pack:<slug>`: lists the member slugs of
 * a published pack. Metadata only (public, like browse) — login + visibility
 * are still enforced per skill by /download and /raw when the CLI fetches the
 * actual bytes, and that is also where per-skill download counts land.
 */
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const url = new URL(req.url);

  const pack = await prisma.skillPack.findUnique({
    where: { slug: params.slug },
    select: {
      id: true,
      slug: true,
      name: true,
      summary: true,
      isPublished: true,
      items: {
        where: { skill: INSTALLABLE_SKILL_WHERE },
        orderBy: { sortOrder: 'asc' },
        select: {
          skill: {
            select: { slug: true, name: true, currentVersion: { select: { version: true } } },
          },
        },
      },
    },
  });
  if (!pack || !pack.isPublished) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Pack-level install counter (best-effort, don't block the response). The
  // CLI passes via=install exactly once per `skills install pack:<slug>` run.
  // Only counted for a resolved (logged-in) caller so anonymous curls can't
  // inflate the number — installs require login anyway.
  if (url.searchParams.get('via') === 'install') {
    resolveActor(req)
      .then((actor) =>
        actor
          ? prisma.skillPack.update({
              where: { id: pack.id },
              data: { installCount: { increment: 1 } },
            })
          : undefined,
      )
      .catch(() => undefined);
  }

  return NextResponse.json({
    slug: pack.slug,
    name: pack.name,
    summary: pack.summary,
    skills: pack.items.map((i) => ({
      slug: i.skill.slug,
      name: i.skill.name,
      version: i.skill.currentVersion?.version ?? null,
    })),
  });
}
