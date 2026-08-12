import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getRelatedDocs } from '@/lib/library-queries';

export const dynamic = 'force-dynamic';

// GET /api/library/docs/[id]/related (login) — up to 6 similar public docs for
// the reader's 相似文档 tab. Public-only, so no per-viewer access check needed.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const docs = await getRelatedDocs(params.id, 6);
  return NextResponse.json({
    docs: docs.map((d) => ({
      slug: d.slug,
      title: d.title,
      author: d.author,
      docType: d.docType,
      coverUrl: d.coverUrl,
      siteName: d.siteName,
      estReadMinutes: d.estReadMinutes,
    })),
  });
}
