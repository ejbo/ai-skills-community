import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/admin';
import { toPublicAuthor } from '@/lib/user-identity';
import { getShortForFeed, listShorts, type ShortFeedRow } from '@/lib/video/shorts-queries';
import { parseShortsSort } from '@/lib/video/shorts-shared';
import { ShortsFeed } from './_components/ShortsFeed';
import type { ShortView } from './_components/types';

export const dynamic = 'force-dynamic';

// Next 14 交给 page 的 searchParams 运行时可能是 string[]（?v=a&v=b）——取第一个。
function firstParam(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? '').trim();
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('shorts');
  return { title: t('meta_title') };
}

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export default async function ShortsPage({ searchParams }: PageProps) {
  const session = await requireUser();
  const viewerId = session.user.id;
  const viewerIsAdmin = Boolean(session.user.isAdmin);

  const sort = parseShortsSort(firstParam(searchParams.sort));
  const deepLinkId = firstParam(searchParams.v);
  const focus = firstParam(searchParams.focus);

  const [feed, deepLinked] = await Promise.all([
    listShorts({ sort, viewerId, limit: 8 }),
    deepLinkId ? getShortForFeed(deepLinkId, viewerId) : Promise.resolve(null),
  ]);

  // The deep-linked short renders first; the feed continues after it (dedupe).
  const rows = deepLinked
    ? [deepLinked, ...feed.items.filter((s) => s.id !== deepLinked.id)]
    : feed.items;

  const toView = (s: ShortFeedRow): ShortView => ({
    id: s.id,
    slug: s.slug,
    title: s.title,
    summary: s.summary,
    videoUrl: s.videoUrl,
    posterUrl: s.posterUrl,
    mimeType: s.mimeType,
    width: s.width,
    height: s.height,
    durationSec: s.durationSec,
    viewCount: s.viewCount,
    likeCount: s.likeCount,
    commentCount: s.commentCount,
    favoriteCount: s.favoriteCount,
    featured: s.featured,
    // 隐私账号: strip department/lab server-side before authors reach the client.
    uploader: toPublicAuthor(s.uploader, viewerIsAdmin),
    likedByMe: s.likedByMe,
    favoritedByMe: s.favoritedByMe,
  });

  return (
    <ShortsFeed
      // Keyed per stream — switching 最热/最新 must remount the feed, not keep
      // the previous stream's items and cursor.
      key={sort}
      initialItems={rows.map(toView)}
      initialCursor={feed.nextCursor}
      initialHasMore={feed.hasMore}
      sort={sort}
      currentUser={{ id: viewerId, isAdmin: viewerIsAdmin, handle: session.user.handle }}
      initialFocus={focus && deepLinked ? { itemId: deepLinked.id, commentId: focus } : null}
    />
  );
}
