import Link from 'next/link';
import { requirePermission } from '@/lib/admin';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { prisma } from '@/lib/db';
import { listVideoCategories } from '@/lib/video/queries';
import { VideoForm } from '@/components/video/VideoForm';
import { EditVideoControls } from './EditVideoControls';

export const dynamic = 'force-dynamic';

export default async function EditVideoPage({ params }: { params: { id: string } }) {
  await requirePermission('videos');
  const t = await getTranslations({ namespace: 'video' });

  const [video, categories] = await Promise.all([
    prisma.video.findUnique({
      where: { id: params.id },
      include: {
        category: { select: { slug: true } },
        tags: { include: { tag: { select: { name: true } } } },
      },
    }),
    listVideoCategories(),
  ]);

  // 随刷短视频 are managed at /manage/shorts — the long-video editor's fields
  // (and its PATCH route, which now 404s shorts) don't apply to them.
  if (!video || video.isShort) notFound();

  const status: 'draft' | 'published' = video.status === 'published' ? 'published' : 'draft';
  const visibility: 'public' | 'unlisted' | 'private' =
    video.visibility === 'unlisted' || video.visibility === 'private' ? video.visibility : 'public';

  const formVideo = {
    id: video.id,
    slug: video.slug,
    title: video.title,
    summary: video.summary,
    descriptionMd: video.descriptionMd,
    categorySlug: video.category?.slug ?? null,
    tags: video.tags.map((tt) => tt.tag.name),
    language: video.language,
    intervieweeName: video.intervieweeName,
    intervieweeTitle: video.intervieweeTitle,
    intervieweeOrg: video.intervieweeOrg,
    intervieweeBio: video.intervieweeBio,
    transcriptText: video.transcriptText,
    status,
    visibility,
    featured: video.featured,
    videoUrl: video.videoUrl,
    videoKey: video.videoKey,
    posterUrl: video.posterUrl,
    posterKey: video.posterKey,
    previewUrl: video.previewUrl,
    previewKey: video.previewKey,
    durationSec: video.durationSec,
    width: video.width,
    height: video.height,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Link href="/manage/videos" className="hover:text-zinc-900">
          ← {t('manage.title')}
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{video.title}</h2>
          <div className="mt-0.5 font-mono text-[11px] text-muted">{video.slug}</div>
        </div>
        <EditVideoControls slug={video.slug} />
      </div>

      <VideoForm
        categories={categories.map((c) => ({ id: c.id, slug: c.slug, name: c.name }))}
        mode="edit"
        video={formVideo}
      />
    </div>
  );
}
