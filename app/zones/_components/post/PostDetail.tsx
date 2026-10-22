'use client';

// Post detail composition: article column (draft banner, the sticky
// PostHeader, body via ZoneMarkdown size="article",
// attachments on mobile, PostActionBar, comments, related) and the xl: right
// rail (PostRail — the full rail, or a 40 px strip while the docked preview
// panel narrows the page). The grid follows the page BAND the preview host
// measures (`usePageBand`), never a viewport breakpoint: at 1440 the article
// is 696 px with the panel closed and the rail becomes the strip the moment
// the panel docks. The comment count is lifted here so the action bar and the
// section header stay in step with live inserts/deletes; like / bookmark
// state is created ONCE (useLikeBookmark) and shared by the action bar and
// the context strip. View recording is the RSC page's job.
//
// `canEdit` is decided by the RSC (`canViewerEditZonePost` → the PATCH route's
// own `canEditZonePostContent`) and is the ONLY edit gate on this page: the
// draft banner, the header's 编辑 and the action bar's 编辑 pill all read it,
// so a co-author the zone gate would refuse never sees an entry that 403s.
//
// 站内翻译: the whole article sits in ONE <TranslatableScope kind="zone_post">, so a
// single 翻译 / 显示原文 flips the title, the summary (PostHeader), the body
// (PostBody) and the TOC (PostRail re-derives its headings from the translated
// markdown — ZoneMarkdown re-assigns the heading ids from the rendered text, so
// the rail and the anchors keep agreeing). The 翻译 link and the attribution share
// ONE slot, directly above the body: a reader decides before reading, and the
// measured phone action bar has no room for another control. Never offered on a
// locked stub (returned above the scope — the loader would 404 it) nor on a draft
// (every autosave would mint cache rows for text nobody else will ever read).

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FileEdit, MessageCircle } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { ReportReader } from '@/components/reports/report-view';
import { TranslatableScope, TranslateControl, TranslateNote, useTranslated } from '@/components/translate/TranslatableScope';
import { usePageBand } from '@/components/zones/preview/PreviewProvider';
import { ZoneMarkdown } from '@/components/zones/ZoneMarkdown';
import type { LeadRoles } from '@/lib/zones/lead-roles';
import { ARTICLE_MEASURE_CLASS } from '@/lib/zones/prose';
import type { ZoneAccess, ZoneCurrentUser, ZonePostCardView, ZonePostDetailView } from '@/lib/zones/types';
import { PostActionBar } from './PostActionBar';
import { PostAttachmentsPanel } from './PostAttachmentsPanel';
import { PostComments } from './PostComments';
import { PostHeader } from './PostHeader';
import { PostRail } from './PostRail';
import { PostUnlock } from './PostUnlock';
import { RelatedPosts } from './RelatedPosts';
import { ReportArticle } from '@/components/reports/ReportArticle';
import { CommentsDrawer } from './CommentsDrawer';
import { useLikeBookmark } from './useLikeBookmark';
import { zonePostEditHref } from '@/lib/zones/shared';

const HEADING_SCROLL_MARGIN = '[&_h1]:scroll-mt-28 [&_h2]:scroll-mt-28 [&_h3]:scroll-mt-28 [&_h4]:scroll-mt-28';

/**
 * The body as the scope currently shows it — the translation while it is showing,
 * else the original. Own-line `[embed:…]` tokens are byte-identical in a
 * translation, so the SERVER-resolved `post.embeds` map keeps matching.
 */
function PostBody({ post }: { post: ZonePostDetailView }) {
  const tr = useTranslated();
  return <ZoneMarkdown content={tr?.body || post.bodyMd} embeds={post.embeds} size="article" />;
}

export function PostDetail({
  post,
  zone,
  access,
  currentUser,
  focusId,
  related = [],
  leadRoles,
  canEdit,
  canSeeViewers = false,
}: {
  post: ZonePostDetailView;
  zone: { id: string; slug: string; name: string };
  access: ZoneAccess;
  currentUser: ZoneCurrentUser | null;
  /** `?focus=<commentId>` — notification deep link. */
  focusId?: string;
  related?: ZonePostCardView[];
  /** handle → 主版主 / 版主 (built by the RSC page from the zone owner + moderators). */
  leadRoles?: LeadRoles;
  /** Server-decided content-edit gate (see the file header). */
  canEdit: boolean;
  /** 超级管理员：帖子头部显示「谁看过」。 */
  canSeeViewers?: boolean;
}) {
  const t = useTranslations('zones');
  const band = usePageBand();
  const lb = useLikeBookmark(post, zone.slug, currentUser);
  const [commentCount, setCommentCount] = useState(post.commentCount);
  const articleRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const commentsRef = useRef<HTMLElement>(null);
  const authors = [post.author, ...post.coauthors];
  // 报告帖子的评论抽屉（CommentsDrawer）：开着时底部评论区不渲染，同一时刻只挂一份 PostComments。
  const [commentsOpen, setCommentsOpen] = useState(false);
  const closeComments = useCallback(() => setCommentsOpen(false), []);

  const jumpToComments = () => {
    if (post.report) return setCommentsOpen(true);
    commentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // 指定成员可见 (ask #4): the RSC already handed us a stub — no body, cover,
  // attachments, headings or embeds — so nothing below this line may render.
  // Comments, likes and the related band stay unmounted too: they would each
  // fetch a surface this viewer has not unlocked.
  if (post.accessLocked) return <PostUnlock post={post} zone={zone} />;

  // 右栏从 lg（1024）起出现（2026-10-22 owner：「普通帖子右侧也有空白，目录怎么没了」——容器放宽到 1280 后，
  // 1024–1279 的窗口下 xl 断点还没到，正文又被量尺卡在 880，右边就空着）。报告页同样是 lg。
  const grid =
    band === 'wide'
      ? 'grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_240px]'
      : 'grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_40px]';

  const comments = (
    <PostComments
      zoneSlug={zone.slug}
      postId={post.id}
      currentUser={currentUser}
      canComment={access.canComment}
      canModerate={access.canModerate}
      isMember={access.isMember}
      locked={post.locked}
      focusId={focusId}
      leadRoles={leadRoles}
      onCountChange={(delta) => setCommentCount((n) => Math.max(0, n + delta))}
    />
  );

  // ── 报告帖子（docs/contracts/reports.md §3a「阅读布局」）────────────────────────────────
  // 正文 + 右栏（目录 / 全部展开收起 / 作者 / 评论抽屉入口 / 回到顶部）用 ReportReader；专题时间线默认收起。
  // 站内翻译作用于 Markdown 正文，对原生视图无意义，不给翻译入口。
  if (post.report) {
    const rail = (
      <>
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('rail_strip_authors')}</h3>
          <ul className="space-y-2">
            {authors.map((a) => (
              <li key={a.handle} className="flex items-center gap-2 text-sm">
                <Avatar name={a.displayName} src={a.avatarUrl} size="xs" handle={a.handle} />
                <Link href={`/users/${a.handle}`} className="truncate font-medium hover:underline">
                  {a.displayName}
                </Link>
                <DeptTag department={a.department} lab={a.lab} />
              </li>
            ))}
          </ul>
        </section>
        <button
          type="button"
          onClick={() => setCommentsOpen(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 transition hover:border-zinc-900 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-100 dark:hover:text-zinc-100"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          {t('post_comments')}
          <span className="font-mono tabular-nums text-muted">{commentCount}</span>
        </button>
      </>
    );
    return (
      <>
        <ReportReader report={post.report.report} speakers={post.report.speakers} rail={rail} articleRef={articleRef}>
          {post.status === 'draft' && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-zinc-400 px-4 py-3 text-sm dark:border-zinc-600">
              <span className="inline-flex items-center gap-2">
                <FileEdit className="h-4 w-4 text-muted" />
                {t('post_draft_banner')}
              </span>
              {canEdit && (
                <Link href={zonePostEditHref(zone.slug, post.id)} className="h-8 rounded-lg bg-zinc-900 px-3 text-xs font-medium leading-8 text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200">
                  {t('post_continue_editing')}
                </Link>
              )}
            </div>
          )}
          <PostHeader post={post} zone={zone} leadRoles={leadRoles} titleRef={titleRef} canEdit={canEdit} canSeeViewers={canSeeViewers} />
          <div className={`mt-8 ${HEADING_SCROLL_MARGIN}`}>
            <ReportArticle view={post.report} embeds={post.embeds} />
          </div>
          {post.attachments.length > 0 && <PostAttachmentsPanel attachments={post.attachments} className="mt-8" />}
          <PostActionBar className="mt-8" post={post} zoneSlug={zone.slug} access={access} canEdit={canEdit} currentUser={currentUser} lb={lb} commentCount={commentCount} onCommentJump={jumpToComments} />
          {!commentsOpen && (
            <section ref={commentsRef} id="comments" className="cv-auto mt-10 scroll-mt-24 border-t border-zinc-200 pt-8 dark:border-zinc-800">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold tracking-tight">
                <MessageCircle className="h-4 w-4 text-muted" />
                {t('post_comments')}
                <span className="font-mono text-sm tabular-nums text-muted">{commentCount}</span>
              </h2>
              {comments}
            </section>
          )}
          <RelatedPosts posts={related.filter((p) => p.id !== post.id)} className="cv-auto mt-12" />
        </ReportReader>
        <CommentsDrawer open={commentsOpen} onClose={closeComments} count={commentCount}>
          {comments}
        </CommentsDrawer>
      </>
    );
  }

  return (
    <TranslatableScope
      kind="zone_post"
      id={post.id}
      fields={{ title: post.title, summary: post.summary, body: post.bodyMd }}
      disabled={post.status === 'draft'}
    >
    <div className={grid} data-post-band={band}>
      <article ref={articleRef} className={`min-w-0 ${ARTICLE_MEASURE_CLASS}`}>
        {post.status === 'draft' && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-zinc-400 px-4 py-3 text-sm dark:border-zinc-600">
            <span className="inline-flex items-center gap-2">
              <FileEdit className="h-4 w-4 text-muted" />
              {t('post_draft_banner')}
            </span>
            {canEdit && (
              <Link
                href={zonePostEditHref(zone.slug, post.id)}
                className="h-8 rounded-lg bg-zinc-900 px-3 text-xs font-medium leading-8 text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {t('post_continue_editing')}
              </Link>
            )}
          </div>
        )}

        {/* First in the column so `sticky` pins it at the top; zero-height until the h1 leaves. */}

        <PostHeader post={post} zone={zone} leadRoles={leadRoles} titleRef={titleRef} canEdit={canEdit} canSeeViewers={canSeeViewers} />

        <div className={`mt-8 ${HEADING_SCROLL_MARGIN}`}>
          {/* One slot: 「译自… · 显示原文」 while translated, else 翻译 / 翻译中… / 显示译文. */}
          <TranslateNote />
          <TranslateControl className="mb-3" />
          {post.bodyMd.trim() ? (
            <PostBody post={post} />
          ) : (
            <p className="text-sm text-muted">{t('post_body_empty')}</p>
          )}
        </div>

        {post.attachments.length > 0 && <PostAttachmentsPanel attachments={post.attachments} className="mt-8 lg:hidden" />}

        <PostActionBar
          className="mt-8"
          post={post}
          zoneSlug={zone.slug}
          access={access}
          canEdit={canEdit}
          currentUser={currentUser}
          lb={lb}
          commentCount={commentCount}
          onCommentJump={jumpToComments}
        />

        <section ref={commentsRef} id="comments" className="cv-auto mt-10 scroll-mt-24 border-t border-zinc-200 pt-8 dark:border-zinc-800">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold tracking-tight">
            <MessageCircle className="h-4 w-4 text-muted" />
            {t('post_comments')}
            <span className="font-mono text-sm tabular-nums text-muted">{commentCount}</span>
          </h2>
          {comments}
        </section>

        <RelatedPosts posts={related.filter((p) => p.id !== post.id)} className="cv-auto mt-12" />
      </article>

      <aside className="hidden lg:block">
        <PostRail band={band} post={post} authors={authors} leadRoles={leadRoles} articleRef={articleRef} />
      </aside>
    </div>
    </TranslatableScope>
  );
}
