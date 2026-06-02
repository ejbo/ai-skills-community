import { NextResponse } from 'next/server';
import { storage } from '@/lib/storage';
import { prisma } from '@/lib/db';
import { resolveActor } from '@/lib/auth/either';
import { canAccessSkillContent } from '@/lib/access';

/**
 * Raw stored-object proxy (local-dev storage driver). Gated so the bundle bytes
 * can't be fetched directly to bypass the /raw access checks. Keys look like
 * `skills/<slug>/<version>.zip`; we resolve the owning skill and enforce the
 * same access decision as every other content gate.
 */
export async function GET(req: Request, { params }: { params: { key: string[] } }) {
  const key = params.key.join('/');

  const slug = key.match(/^skills\/([^/]+)\//)?.[1];
  if (slug) {
    const skill = await prisma.skill.findUnique({
      where: { slug },
      select: { id: true, authorId: true, visibility: true, status: true, deletedAt: true },
    });
    if (!skill) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const actor = await resolveActor(req);
    let grantStatus = null;
    if (actor && skill.visibility === 'restricted' && actor.id !== skill.authorId && !actor.isAdmin) {
      const grant = await prisma.skillAccessRequest.findUnique({
        where: { skillId_userId: { skillId: skill.id, userId: actor.id } },
        select: { status: true },
      });
      grantStatus = grant?.status ?? null;
    }
    const decision = canAccessSkillContent(skill, actor, grantStatus);
    if (!decision.canContent) {
      return NextResponse.json(
        { error: decision.kind === 'auth_required' ? 'auth_required' : 'forbidden' },
        { status: decision.kind === 'auth_required' ? 401 : decision.kind === 'needs_request' ? 403 : 404 },
      );
    }
  }

  try {
    const buf = await storage.get(key);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'content-type': key.endsWith('.zip') ? 'application/zip' : 'application/octet-stream',
        'cache-control': 'private, max-age=60',
      },
    });
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
}
