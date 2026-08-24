import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { logAdmin } from '@/lib/audit';
import { updateChapterContent } from '@/lib/library/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;

const patchSchema = z.object({
  // Tiptap HTML from the editor — sanitized server-side before storage.
  html: z.string().min(1, '内容不能为空').max(2_000_000),
  title: z.string().trim().max(300).nullable().optional(),
});

// GET (uploader/admin) — the chapter's current HTML for the content editor.
export async function GET(
  _req: Request,
  { params }: { params: { id: string; chapterIndex: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const doc = await prisma.libraryDoc.findUnique({
    where: { id: params.id },
    select: { id: true, uploaderId: true, deletedAt: true },
  });
  if (!doc || doc.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (doc.uploaderId !== session.user.id && !can(session.user, 'library')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const idx = Number.parseInt(params.chapterIndex, 10);
  if (!Number.isFinite(idx) || idx < 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const chapter = await prisma.libraryChapter.findUnique({
    where: { docId_chapterIndex: { docId: doc.id, chapterIndex: idx } },
    select: { chapterIndex: true, title: true, html: true },
  });
  if (!chapter) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ chapter });
}

// PATCH (uploader/admin) — replace the chapter's reading content (and title).
export async function PATCH(
  req: Request,
  { params }: { params: { id: string; chapterIndex: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`library:chapter-edit:${session.user.id}`, 20, MINUTE_MS);
  if (!gate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const doc = await prisma.libraryDoc.findUnique({
    where: { id: params.id },
    select: { id: true, uploaderId: true, deletedAt: true },
  });
  if (!doc || doc.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const isUploader = doc.uploaderId === session.user.id;
  if (!isUploader && !can(session.user, 'library')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const idx = Number.parseInt(params.chapterIndex, 10);
  if (!Number.isFinite(idx) || idx < 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: 'invalid_input', reason: first?.message ?? '请求参数无效' },
      { status: 400 },
    );
  }

  const ok = await updateChapterContent(doc.id, idx, parsed.data.html);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (parsed.data.title !== undefined) {
    await prisma.libraryChapter.update({
      where: { docId_chapterIndex: { docId: doc.id, chapterIndex: idx } },
      data: { title: parsed.data.title?.trim() || null },
    });
  }

  if (!isUploader) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'edit_library_chapter',
      targetType: 'library_doc',
      targetId: doc.id,
      details: { chapterIndex: idx },
    });
  }
  return NextResponse.json({ ok: true });
}
