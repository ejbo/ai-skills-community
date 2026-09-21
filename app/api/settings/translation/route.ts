import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { CONTENT_LANGS, MAX_SKIP_LANGS, sanitizeSkipLangs } from '@/lib/translate/shared';

export const dynamic = 'force-dynamic';

// 设置 → 语言 → 内容翻译. Two account-level switches (they follow the member across
// devices, unlike the `locale` cookie): 自动翻译 (opt-in — X shipping it default-on
// with no master switch is its most-reported complaint) and 「不翻译此语言」.
// `.strict()` so a stale client posting an unknown key gets a 400, not a silent
// no-op that toasts 已保存.
const schema = z
  .object({
    autoTranslate: z.boolean().optional(),
    translateSkipLangs: z.array(z.enum(CONTENT_LANGS)).max(MAX_SKIP_LANGS).optional(),
  })
  .strict();

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { autoTranslate: true, translateSkipLangs: true },
  });
  return NextResponse.json({
    ok: true,
    autoTranslate: user?.autoTranslate ?? false,
    translateSkipLangs: sanitizeSkipLangs(user?.translateSkipLangs),
  });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const data: { autoTranslate?: boolean; translateSkipLangs?: string[] } = {};
  if (parsed.data.autoTranslate !== undefined) data.autoTranslate = parsed.data.autoTranslate;
  if (parsed.data.translateSkipLangs !== undefined) data.translateSkipLangs = sanitizeSkipLangs(parsed.data.translateSkipLangs);
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  await prisma.user.update({ where: { id: session.user.id }, data });
  return NextResponse.json({ ok: true, ...data });
}
