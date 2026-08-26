import { prisma } from '@/lib/db';

// Site-wide search core, shared by the ⌘K palette API (app/api/search, small
// perType) and the full results page (app/search, larger perType). Only
// surfaces publicly-listable rows (published/ready, non-private, non-deleted;
// active users) so nothing private leaks. Per-tab in-page searches (skills
// browse, library, videos, discussion) stay scoped to their own tab.

/** Markdown body → short plain-text excerpt for untitled content (feed posts). */
export function mdExcerpt(md: string, max = 48): string {
  const text = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → label
    .replace(/[#>*`~_|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export interface SiteSearchResults {
  skills: { slug: string; name: string; author: string; date: Date }[];
  /** meta is viewer-aware: '@handle', or '' for a 隐私账号 (non-admin viewer). */
  users: { handle: string; displayName: string; meta: string }[];
  categories: { slug: string; name: string }[];
  tags: { slug: string; name: string; usageCount: number }[];
  videos: { slug: string; title: string; author: string; date: Date }[];
  library: { slug: string; title: string; author: string; date: Date }[];
  discussions: { kind: 'topic' | 'post'; id: string; title: string; author: string; date: Date }[];
  packs: { slug: string; name: string; date: Date }[];
  feedback: { id: string; title: string; author: string; date: Date }[];
  events: { id: string; title: string; author: string; date: Date }[];
  votes: { id: string; title: string; author: string; date: Date }[];
  /** 技术专区: public zones (kind zone) + published, publicly-visible posts of public zones (kind post), merged newest first. */
  zones: { kind: 'zone' | 'post'; id: string; slug: string; title: string; author: string; date: Date; href: string }[];
}

export const EMPTY_SEARCH_RESULTS: SiteSearchResults = {
  skills: [],
  users: [],
  categories: [],
  tags: [],
  videos: [],
  library: [],
  discussions: [],
  packs: [],
  feedback: [],
  events: [],
  votes: [],
  zones: [],
};

export async function searchSite(
  rawQ: string,
  opts: { viewerCanSeeIdentity: boolean; perType?: number },
): Promise<SiteSearchResults> {
  // Cap the term: it feeds 14 parallel ILIKE scans (three over full bodyMd
  // columns) — an unbounded pasted blob would make every scan pathological.
  const q = rawQ.trim().slice(0, 64);
  if (!q) return EMPTY_SEARCH_RESULTS;
  const perType = Math.min(50, Math.max(1, opts.perType ?? 6));
  const contains = { contains: q, mode: 'insensitive' as const };

  const [
    skills,
    users,
    categories,
    tags,
    videos,
    libraryDocs,
    topics,
    posts,
    packs,
    feedback,
    events,
    votes,
    zoneRows,
    zonePosts,
  ] = await Promise.all([
      prisma.skill.findMany({
        where: {
          status: 'published',
          deletedAt: null,
          visibility: { not: 'private' },
          OR: [{ name: contains }, { summary: contains }, { slug: contains }],
        },
        select: { slug: true, name: true, updatedAt: true, author: { select: { displayName: true } } },
        orderBy: [{ trendingScore: 'desc' }, { downloadCount: 'desc' }],
        take: perType,
      }),
      prisma.user.findMany({
        where: { isActive: true, OR: [{ displayName: contains }, { handle: contains }] },
        select: { handle: true, displayName: true, isPrivate: true },
        take: perType,
      }),
      prisma.category.findMany({
        where: { OR: [{ name: contains }, { slug: contains }] },
        select: { slug: true, name: true },
        take: perType,
      }),
      prisma.tag.findMany({
        where: { OR: [{ name: contains }, { slug: contains }] },
        select: { slug: true, name: true, usageCount: true },
        orderBy: { usageCount: 'desc' },
        take: perType,
      }),
      prisma.video.findMany({
        where: {
          status: 'published',
          visibility: { not: 'private' },
          deletedAt: null,
          // 随刷短视频 stay out of the long-video result list (own feed surface).
          isShort: false,
          OR: [{ title: contains }, { slug: contains }],
        },
        select: {
          slug: true,
          title: true,
          publishedAt: true,
          createdAt: true,
          uploader: { select: { displayName: true } },
        },
        orderBy: { viewCount: 'desc' },
        take: perType,
      }),
      // 书籍 / 知识库 — mirrors the skills visibility rule: private excluded,
      // restricted stays discoverable (content itself is gated at the doc page).
      prisma.libraryDoc.findMany({
        where: {
          status: 'ready',
          deletedAt: null,
          visibility: { not: 'private' },
          // summaryEn is the English twin of summary (lib/library/i18n-content.ts)
          // — an English phrase may only exist there.
          OR: [
            { title: contains },
            { author: contains },
            { summary: contains },
            { summaryEn: contains },
          ],
        },
        select: {
          slug: true,
          title: true,
          author: true,
          siteName: true,
          publishedAt: true,
          createdAt: true,
        },
        orderBy: { viewCount: 'desc' },
        take: perType,
      }),
      prisma.discussionTopic.findMany({
        where: { OR: [{ title: contains }, { bodyMd: contains }] },
        select: {
          id: true,
          title: true,
          lastActivityAt: true,
          author: { select: { displayName: true } },
        },
        orderBy: { lastActivityAt: 'desc' },
        take: perType,
      }),
      prisma.post.findMany({
        where: { bodyMd: contains },
        select: {
          id: true,
          bodyMd: true,
          createdAt: true,
          author: { select: { displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: perType,
      }),
      prisma.skillPack.findMany({
        where: { isPublished: true, OR: [{ name: contains }, { summary: contains }, { slug: contains }] },
        select: { slug: true, name: true, updatedAt: true },
        orderBy: { installCount: 'desc' },
        take: perType,
      }),
      prisma.feedback.findMany({
        where: { OR: [{ title: contains }, { bodyMd: contains }] },
        select: {
          id: true,
          title: true,
          createdAt: true,
          author: { select: { displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: perType,
      }),
      // 活动 — startAt desc so upcoming events surface above long-past ones.
      prisma.event.findMany({
        where: {
          deletedAt: null,
          OR: [{ title: contains }, { city: contains }, { venue: contains }, { speakers: { some: { name: contains } } }],
        },
        select: {
          id: true,
          title: true,
          startAt: true,
          author: { select: { displayName: true } },
        },
        orderBy: { startAt: 'desc' },
        take: perType,
      }),
      // 投票活动 — drafts stay out (creator-only surface).
      prisma.voteActivity.findMany({
        where: {
          deletedAt: null,
          status: 'published',
          OR: [{ title: contains }, { descriptionMd: contains }],
        },
        select: {
          id: true,
          title: true,
          createdAt: true,
          creator: { select: { displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: perType,
      }),
      // 技术专区 版块 — `members` zones stay out of global search (their cards
      // are still browsable on the hub; content is gated there).
      prisma.zone.findMany({
        where: {
          deletedAt: null,
          visibility: 'public',
          OR: [{ name: contains }, { tagline: contains }, { slug: contains }],
        },
        select: {
          id: true,
          slug: true,
          name: true,
          lastActivityAt: true,
          owner: { select: { displayName: true } },
        },
        orderBy: { lastActivityAt: 'desc' },
        take: perType,
      }),
      // 技术专区 帖子 — published, in a live public zone, and PUBLICLY visible.
      // v2 gave posts their own visibility that NARROWS the zone's: 'members'
      // needs zone membership and 'restricted' needs a ZonePostViewer grant, so
      // neither is publicly listable. Site search has no viewer identity beyond
      // `viewerCanSeeIdentity`, so it may only ever surface `visibility: 'zone'`.
      prisma.zonePost.findMany({
        where: {
          status: 'published',
          deletedAt: null,
          visibility: 'zone',
          zone: { deletedAt: null, visibility: 'public' },
          OR: [{ title: contains }, { summary: contains }],
        },
        select: {
          id: true,
          title: true,
          publishedAt: true,
          createdAt: true,
          author: { select: { displayName: true } },
          zone: { select: { slug: true } },
        },
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        take: perType,
      }),
    ]);

  return {
    skills: skills.map((s) => ({ slug: s.slug, name: s.name, author: s.author.displayName, date: s.updatedAt })),
    // 隐私账号: the @handle locator is decided server-side — empty meta for
    // non-admin searchers (handle still ships; it powers the profile-link href).
    users: users.map((u) => ({
      handle: u.handle,
      displayName: u.displayName,
      meta: u.isPrivate && !opts.viewerCanSeeIdentity ? '' : `@${u.handle}`,
    })),
    categories,
    tags,
    videos: videos.map((v) => ({
      slug: v.slug,
      title: v.title,
      author: v.uploader.displayName,
      date: v.publishedAt ?? v.createdAt,
    })),
    library: libraryDocs.map((d) => ({
      slug: d.slug,
      title: d.title,
      author: d.author || d.siteName || '',
      date: d.publishedAt ?? d.createdAt,
    })),
    // 讨论帖（title 命中，权重高）在前，动态（正文摘要）在后，同组截断。
    discussions: [
      ...topics.map((t) => ({
        kind: 'topic' as const,
        id: t.id,
        title: t.title,
        author: t.author.displayName,
        date: t.lastActivityAt,
      })),
      ...posts.map((p) => ({
        kind: 'post' as const,
        id: p.id,
        // May be '' for media-only posts — consumers localize the fallback
        // label at render time (nav.search_post_media); no locale here.
        title: mdExcerpt(p.bodyMd),
        author: p.author.displayName,
        date: p.createdAt,
      })),
    ].slice(0, perType + Math.max(2, Math.floor(perType / 3))),
    packs: packs.map((p) => ({ slug: p.slug, name: p.name, date: p.updatedAt })),
    feedback: feedback.map((f) => ({
      id: f.id,
      title: f.title,
      author: f.author.displayName,
      date: f.createdAt,
    })),
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      author: e.author.displayName,
      date: e.startAt,
    })),
    votes: votes.map((v) => ({
      id: v.id,
      title: v.title,
      author: v.creator.displayName,
      date: v.createdAt,
    })),
    // 版块与帖子合并，按时间倒序，同组截断。
    zones: [
      ...zoneRows.map((z) => ({
        kind: 'zone' as const,
        id: z.id,
        slug: z.slug,
        title: z.name,
        author: z.owner.displayName,
        date: z.lastActivityAt,
        href: `/zones/${z.slug}`,
      })),
      ...zonePosts.map((p) => ({
        kind: 'post' as const,
        id: p.id,
        slug: p.zone.slug,
        title: p.title,
        author: p.author.displayName,
        date: p.publishedAt ?? p.createdAt,
        href: `/zones/${p.zone.slug}/posts/${p.id}`,
      })),
    ]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, perType),
  };
}
