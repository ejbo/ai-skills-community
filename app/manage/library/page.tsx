import { prisma } from '@/lib/db';
import { LibraryManager } from './LibraryManager';
import { AiSettingsCard } from './AiSettingsCard';
import { EgressTestPanel } from './EgressTestPanel';

export const dynamic = 'force-dynamic';

export default async function AdminLibraryPage() {
  const docs = await prisma.libraryDoc.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      slug: true,
      title: true,
      docType: true,
      format: true,
      status: true,
      processingError: true,
      aiIndexState: true,
      aiError: true,
      featured: true,
      shelfCount: true,
      viewCount: true,
      deletedAt: true,
      createdAt: true,
      uploader: { select: { handle: true, displayName: true } },
    },
  });

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold tracking-tight">知识库管理</h2>
      <p className="text-xs text-muted">
        管理用户收录的网页 / PDF / EPUB 文档：调整类型、推荐、重跑提取或重建 AI 导读。删除为软删除，可随时恢复。
      </p>
      <AiSettingsCard />
      <EgressTestPanel />
      <LibraryManager
        docs={docs.map((d) => ({
          id: d.id,
          slug: d.slug,
          title: d.title,
          docType: d.docType,
          format: d.format,
          status: d.status,
          processingError: d.processingError,
          aiIndexState: d.aiIndexState,
          aiError: d.aiError,
          featured: d.featured,
          shelfCount: d.shelfCount,
          viewCount: d.viewCount,
          uploader: d.uploader,
          deletedAt: d.deletedAt ? d.deletedAt.toISOString() : null,
          createdAt: d.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
