// GET /api/users/search?q= → { items: SearchPersonView[] }
//
// The people picker behind @人 and 合著者. Site-wide on purpose: the owner asked
// that a co-author be anyone on the platform, and a mention is meaningless if it
// cannot reach the person you mean.
//
// Matching is the two-step the 员工名单 contract requires (CLAUDE.md): a broad
// `contains` PREFILTER in SQL — Prisma cannot express "the digits of a column" —
// then the exact decision in app code (lib/user-search.ts), which is what makes
// name tokens order-insensitive and 工号 match on its digit run.
//
// Privacy: rows go through `toPublicAuthor` with the viewer's own `identity`
// permission, so a private account's 部门/研究所 never rides along. The 工号 is
// matched but NEVER returned — for an SSO account it is already the handle, so
// matching leaks nothing new, while echoing it would hand every logged-in user
// a roster export.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { can } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { AUTHOR_IDENTITY_FIELDS, toPublicAuthor, type PublicAuthor } from '@/lib/user-identity';
import { prefilterTerms, searchPeople, type SearchablePerson } from '@/lib/user-search';

export const dynamic = 'force-dynamic';

const TAKE = 8;
/** Rows pulled before the exact re-check; wide enough that ranking has choices. */
const PREFILTER_TAKE = 60;
const SEARCHES_PER_MINUTE = 120;

export interface SearchPersonView extends PublicAuthor {
  userId: string;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  // A picker fires on every keystroke; the cap is per user and generous.
  const gate = rateLimit(`users:search:${session.user.id}`, SEARCHES_PER_MINUTE, 60_000);
  if (!gate.allowed) return NextResponse.json({ items: [] });

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 64);
  const terms = prefilterTerms(q);
  if (terms.length === 0) return NextResponse.json({ items: [] });

  // OR every token across every identifying column. This is deliberately WIDER
  // than the real predicate (a row matching one token can still fail the
  // all-tokens re-check) — never narrower, or the exact matcher would never see
  // the row it should have accepted.
  const rows = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: terms.flatMap((t) => [
        { displayName: { contains: t, mode: 'insensitive' as const } },
        { handle: { contains: t, mode: 'insensitive' as const } },
        { huaweiW3Name: { contains: t, mode: 'insensitive' as const } },
        { huaweiW3Id: { contains: t.replace(/\D+/g, '') || t, mode: 'insensitive' as const } },
      ]),
    },
    select: { id: true, huaweiW3Id: true, huaweiW3Name: true, ...AUTHOR_IDENTITY_FIELDS },
    orderBy: [{ displayName: 'asc' }, { handle: 'asc' }],
    take: PREFILTER_TAKE,
  });

  const canSeeIdentity = can(session.user, 'identity');
  const candidates: (SearchablePerson & { row: (typeof rows)[number] })[] = rows.map((row) => ({
    userId: row.id,
    handle: row.handle,
    displayName: row.displayName,
    accountNumber: row.huaweiW3Id,
    altName: row.huaweiW3Name,
    row,
  }));

  const items: SearchPersonView[] = searchPeople(q, candidates, TAKE).map((c) => ({
    userId: c.userId,
    ...toPublicAuthor(c.row, canSeeIdentity),
  }));

  return NextResponse.json({ items });
}
