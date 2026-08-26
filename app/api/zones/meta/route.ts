import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { canUserCreateZone } from '@/lib/zones/access';
import { zoneFacets } from '@/lib/zones/queries';

export const dynamic = 'force-dynamic';

// GET /api/zones/meta — prefill for the create wizard: 研究所/部门 option lists
// (existing zones ∪ the employee directory) and the viewer's own affiliation.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const [facets, canCreate, me] = await Promise.all([
    zoneFacets(),
    canUserCreateZone(session.user),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { lab: true, department: true } }),
  ]);

  return NextResponse.json({
    labs: facets.labs,
    departments: facets.departments,
    canCreate,
    me: { lab: me?.lab ?? '', department: me?.department ?? '' },
  });
}
