import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { canUserCreateZone } from '@/lib/zones/access';
import { zoneFacets } from '@/lib/zones/queries';

export const dynamic = 'force-dynamic';

// GET /api/zones/meta — prefill for the create wizard: the 研究所 → 实验室 tree
// (lib/org.ts ∪ live 版块 ∪ the employee roster) and the viewer's own affiliation.
// `me.lab` is the viewer's 研究所 and `me.department` their 实验室 — the same
// backwards-reading columns the 版块 rows use (see lib/org.ts).
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const [org, canCreate, me] = await Promise.all([
    zoneFacets(),
    canUserCreateZone(session.user),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { lab: true, department: true } }),
  ]);

  return NextResponse.json({
    institutes: org.institutes,
    labsByInstitute: org.labsByInstitute,
    labs: org.labs,
    canCreate,
    me: { lab: me?.lab ?? '', department: me?.department ?? '' },
  });
}
