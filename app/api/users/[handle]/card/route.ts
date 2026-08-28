import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { can, publicRoleBadge } from '@/lib/permissions';
import { syncAndLoadUserTags } from '@/lib/user-tags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/users/[handle]/card — the hover 用户卡片.
//
// Everything here is already public on the profile page; the card just puts it
// one hover away. 隐私账号 rules are identical (department/lab trimmed unless
// the viewer holds `identity`), and the @handle text is suppressed the same way
// — the handle itself stays because it is the profile URL.
export async function GET(_req: Request, { params }: { params: { handle: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { handle: params.handle },
    select: {
      id: true,
      handle: true,
      displayName: true,
      avatarUrl: true,
      bannerUrl: true,
      bio: true,
      department: true,
      lab: true,
      isPrivate: true,
      isActive: true,
      createdAt: true,
      role: { select: { key: true, name: true, permissions: true } },
    },
  });
  if (!user || !user.isActive) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const canSeeIdentity = can(session.user, 'identity');
  const hide = user.isPrivate && !canSeeIdentity;

  const [tags, skills, docs] = await Promise.all([
    syncAndLoadUserTags(user.id),
    prisma.skill.count({
      where: { authorId: user.id, status: 'published', deletedAt: null, visibility: { not: 'private' } },
    }),
    prisma.libraryDoc.count({
      where: { uploaderId: user.id, status: 'ready', deletedAt: null, visibility: { not: 'private' } },
    }),
  ]);

  return NextResponse.json({
    handle: user.handle,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bannerUrl: user.bannerUrl,
    // 签名 — the same field the profile shows; trimmed for a compact card.
    signature: (user.bio ?? '').slice(0, 200),
    department: hide ? null : user.department,
    lab: hide ? null : user.lab,
    isPrivate: user.isPrivate,
    // Staff roles are trimmed here, not hidden in the client — see publicRoleBadge.
    roleName: publicRoleBadge(user.role)?.name ?? null,
    tags,
    stats: { skills, docs },
    joinedAt: user.createdAt,
  });
}
