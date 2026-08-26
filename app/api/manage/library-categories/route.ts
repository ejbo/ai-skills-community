import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { logAdmin } from '@/lib/audit';
import { bustCategoryCache, findOrCreateCategory } from '@/lib/library/categories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function gate() {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  if (!can(session.user, 'library')) {
    return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { session };
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(24),
  nameEn: z.string().trim().max(48).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

// POST — add an OFFICIAL category (the curated ones members pick from first).
export async function POST(req: Request) {
  const g = await gate();
  if (g.error) return g.error;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  // Reuse find-or-create so an official name that a member already coined is
  // PROMOTED rather than duplicated.
  const result = await findOrCreateCategory(parsed.data.name, g.session!.user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const updated = await prisma.libraryCategory.update({
    where: { slug: result.category.slug },
    data: {
      official: true,
      ...(parsed.data.nameEn !== undefined ? { nameEn: parsed.data.nameEn } : {}),
      ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
    },
    select: { id: true, slug: true, name: true, nameEn: true, official: true, sortOrder: true },
  });
  bustCategoryCache();
  await logAdmin({
    adminUserId: g.session!.user.id,
    action: 'upsert_library_category',
    targetType: 'library_category',
    targetId: updated.id,
    details: { slug: updated.slug, promoted: !result.created },
  });
  return NextResponse.json({ ok: true, category: updated });
}

const patchSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(2).max(24).optional(),
  nameEn: z.string().trim().max(48).optional(),
  official: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

export async function PATCH(req: Request) {
  const g = await gate();
  if (g.error) return g.error;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const { id, ...data } = parsed.data;

  const updated = await prisma.libraryCategory.update({
    where: { id },
    data,
    select: { id: true, slug: true, name: true, nameEn: true, official: true, sortOrder: true },
  });
  bustCategoryCache();
  await logAdmin({
    adminUserId: g.session!.user.id,
    action: 'update_library_category',
    targetType: 'library_category',
    targetId: id,
  });
  return NextResponse.json({ ok: true, category: updated });
}

// DELETE — removes the OPTION, never the documents. Docs keep the slug in
// `categories`, so the tag simply stops being offered and renders as its raw
// slug on anything already filed under it.
export async function DELETE(req: Request) {
  const g = await gate();
  if (g.error) return g.error;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const cat = await prisma.libraryCategory.findUnique({ where: { id }, select: { slug: true } });
  if (!cat) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const inUse = await prisma.libraryDoc.count({ where: { categories: { has: cat.slug } } });
  await prisma.libraryCategory.delete({ where: { id } });
  bustCategoryCache();
  await logAdmin({
    adminUserId: g.session!.user.id,
    action: 'delete_library_category',
    targetType: 'library_category',
    targetId: id,
    details: { slug: cat.slug, docsStillTagged: inUse },
  });
  return NextResponse.json({ ok: true, docsStillTagged: inUse });
}
