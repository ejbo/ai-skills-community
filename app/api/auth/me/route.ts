import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { env } from '@/lib/env';
import { decideImageUrl, selfHostnames } from '@/lib/profile/profile-store';

// avatarUrl / bannerUrl are SHAPE-checked here and decided by decideImageUrl
// below, and both are rendered as `<img src>` (avatar on every surface a person
// appears, banner on the anonymous profile page):
//   avatarUrl — our uploader's `/api/uploads/images/<id>.<ext>` URL, or a clean
//               absolute http(s) URL (an IdP avatar) on a host that is NOT this
//               app's own (a same-origin `<img>` GET carries the viewer's session,
//               so `https://<us>/…/api/skills/x/raw` made every viewer's browser
//               log a download against their own quota) AND whose path does not
//               reach an `/api/` segment on any host — an alias hostname that
//               301s to the app (ai4news → cari) carries the same cookie and no
//               denylist can enumerate every one (urlPathHasApiSegment)
//   bannerUrl — uploader URL only: the SAME rule PUT /api/me/profile enforces for
//               this column, so the two writers can never disagree
// ''/null clears either. The old rule took ANY string starting with `/` or
// `http` — a stored value valid under it still saves unchanged (no-op), it just
// can't be re-set.
const profileSchema = z.object({
  displayName: z.string().min(2).max(64).optional(),
  bio: z.string().max(240).nullable().optional(),
  avatarUrl: z.string().max(2048).nullable().optional(),
  bannerUrl: z.string().max(2048).nullable().optional(),
});

const passwordSchema = z.object({
  current: z.string().min(1).optional(),
  next: z.string().min(8).max(128),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, handle: true, displayName: true, bio: true, avatarUrl: true, bannerUrl: true, isAdmin: true, huaweiW3Id: true, huaweiW3Name: true },
  });
  return NextResponse.json({ user });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (parsed.data.displayName !== undefined) data.displayName = parsed.data.displayName;
  if (parsed.data.bio !== undefined) data.bio = parsed.data.bio || null;

  if (parsed.data.avatarUrl !== undefined || parsed.data.bannerUrl !== undefined) {
    const current = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { avatarUrl: true, bannerUrl: true },
    });
    if (!current) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const blockedHosts = selfHostnames({
      host: req.headers.get('host'),
      forwardedHost: req.headers.get('x-forwarded-host'),
      urls: [env.AUTH_URL, env.APP_URL],
    });
    for (const field of ['avatarUrl', 'bannerUrl'] as const) {
      if (parsed.data[field] === undefined) continue;
      const d = decideImageUrl(parsed.data[field], current[field], {
        allowExternal: field === 'avatarUrl',
        blockedHosts,
      });
      if (!d.ok) return NextResponse.json({ error: 'invalid_input', field }, { status: 400 });
      if (d.changed) data[field] = d.value;
    }
  }

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: { id: true, displayName: true, bio: true, avatarUrl: true, bannerUrl: true },
  });
  return NextResponse.json({ user: updated });
}

export async function PATCH(req: Request) {
  // Password change endpoint.
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = passwordSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // W3 accounts authenticate through the company IdP — no local password may
  // be set or changed here (mirrors the settings/security UI).
  if (user.authMethod === 'huawei_sso' && !user.passwordHash) {
    return NextResponse.json({ error: 'sso_only' }, { status: 403 });
  }

  // If user already has a password, require current to be correct.
  if (user.passwordHash) {
    if (!parsed.data.current) return NextResponse.json({ error: 'current_required' }, { status: 400 });
    const ok = await verifyPassword(parsed.data.current, user.passwordHash);
    if (!ok) return NextResponse.json({ error: 'wrong_password' }, { status: 401 });
  }
  const hash = await hashPassword(parsed.data.next);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hash,
      authMethod: user.huaweiW3Id ? 'both' : 'password',
    },
  });
  return NextResponse.json({ ok: true });
}
