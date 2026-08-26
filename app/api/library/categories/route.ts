import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { findOrCreateCategory, listLibraryCategories } from '@/lib/library/categories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

// GET — the picker's option list (official first, then member-created).
export async function GET() {
  return NextResponse.json({ categories: await listLibraryCategories() });
}

const createSchema = z.object({ name: z.string().trim().min(2).max(24) });

// POST (login) — a member adds a category. Find-or-create: typing a name that
// already exists reuses that category instead of forking the taxonomy.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`library:new-category:${session.user.id}`, 20, HOUR_MS);
  if (!gate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const result = await findOrCreateCategory(parsed.data.name, session.user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, category: result.category, created: result.created });
}
