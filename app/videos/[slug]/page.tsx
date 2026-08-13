import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/admin';
import { prisma } from '@/lib/db';
import { RelatedVideos } from '@/components/video/RelatedVideos';
import { getVideoActor, canViewVideo, canPlayVideo, isVideoPrivileged } from '@/lib/video/access';
import { getVideoBySlug, listTopComments, relatedVideos } from '@/lib/video/queries';
import { toPublicAuthor } from '@/lib/user-identity';
import { VideoPlayer } from '@/components/video/VideoPlayer';
import { VideoMeta } from '@/components/video/VideoMeta';
import { AiPanel } from '@/components/video/AiPanel';
import { CommentSection } from '@/components/video/CommentSection';
import { VideoBreadcrumb } from '@/components/video/VideoBreadcrumb';
import { VideoDescription } from '@/components/video/VideoDescription';
import { ViewPing } from '@/components/video/ViewPing';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { slug: string };
  searchParams: { focus?: string | string[] };
}

export default async function VideoDetailPage({ params, searchParams }: PageProps) {
  const session = await requireUser();
  const actor = await getVideoActor();
  const video = await getVideoBySlug(params.slug);
  if (!video || !canViewVideo(video, actor)) notFound();

  // 随刷短视频 live in the immersive feed, not this detail layout. Comment
  // notifications deep-link here (/videos/<slug>?focus=...) — carry the focus
  // through so the feed auto-opens the comment drawer on the right thread.
  if (video.isShort) {
    const focus = Array.isArray(searchParams.focus) ? searchParams.focus[0] : searchParams.focus;
    redirect(`/videos/shorts?v=${video.id}${focus ? `&focus=${encodeURIComponent(focus)}` : ''}`);
  }

  const privileged = isVideoPrivileged(video, actor);
  const playable = canPlayVideo(video, actor);

  const [{ comments, nextCursor }, related, likeRow, favRow] = await Promise.all([
    listTopComments({ videoId: video.id, actorId: actor?.id ?? null }),
    relatedVideos(video.id, video.categoryId, 12),
    actor
      ? prisma.videoLike.findUnique({ where: { userId_videoId: { userId: actor.id, videoId: video.id } } })
      : Promise.resolve(null),
    actor
      ? prisma.videoFavorite.findUnique({ where: { userId_videoId: { userId: actor.id, videoId: video.id } } })
      : Promise.resolve(null),
  ]);

  const t = await getTranslations('video');

  // 隐私账号: strip department/lab server-side before authors reach the client.
  const viewerIsAdmin = session.user.isAdmin ?? false;
  const publicComments = comments.map((c) => ({ ...c, author: toPublicAuthor(c.author, viewerIsAdmin) }));

  const currentUser = actor
    ? { id: actor.id, isAdmin: actor.isAdmin, handle: session.user.handle }
    : null;

  const aiPanel = <AiPanel slug={video.slug} />;
  const relatedRail = related.length > 0 ? <RelatedVideos videos={related} /> : null;

  return (
    <div className="container py-6 md:py-8">
      <VideoBreadcrumb items={[{ label: t('nav'), href: '/videos?tab=videos' }, { label: video.title }]} />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* MAIN COLUMN */}
        <div className="min-w-0 space-y-6">
          <ViewPing slug={video.slug} />
          <VideoPlayer
            src={playable ? video.videoUrl : null}
            poster={video.posterUrl}
            slug={video.slug}
            durationSec={video.durationSec}
          />

          <VideoMeta
            video={{ ...video, uploader: toPublicAuthor(video.uploader, viewerIsAdmin) }}
            privileged={privileged}
            initialLiked={Boolean(likeRow)}
            initialFavorited={Boolean(favRow)}
          />

          {/* On mobile the AI panel sits between meta and description. */}
          <div className="lg:hidden">{aiPanel}</div>

          {video.descriptionMd?.trim() && <VideoDescription content={video.descriptionMd} />}

          <CommentSection
            slug={video.slug}
            initialComments={publicComments}
            initialCursor={nextCursor}
            currentUser={currentUser}
          />

          {/* Related videos stack below comments on mobile. */}
          {relatedRail && (
            <div className="lg:hidden">
              <h2 className="mb-3 text-lg font-semibold">{t('detail.related')}</h2>
              {relatedRail}
            </div>
          )}
        </div>

        {/* RIGHT RAIL (lg+) */}
        <aside className="hidden space-y-6 lg:block">
          {aiPanel}
          {relatedRail && (
            <div>
              <h2 className="mb-3 text-lg font-semibold">{t('detail.related')}</h2>
              {relatedRail}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
