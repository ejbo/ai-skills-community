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

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FileEdit, MessageCircle } from 'lucide-react';
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
}) {
  const t = useTranslations('zones');
  const band = usePageBand();
  const lb = useLikeBookmark(post, zone.slug, currentUser);
  const [commentCount, setCommentCount] = useState(post.commentCount);
  const articleRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const commentsRef = useRef<HTMLElement>(null);
  const authors = [post.author, ...post.coauthors];

  const jumpToComments = () => commentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // 指定成员可见 (ask #4): the RSC already handed us a stub — no body, cover,
  // attachments, headings or embeds — so nothing below this line may render.
  // Comments, likes and the related band stay unmounted too: they would each
  // fetch a surface this viewer has not unlocked.
  if (post.accessLocked) return <PostUnlock post={post} zone={zone} />;

  const grid =
    band === 'wide'
      ? 'grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,1fr)_240px]'
      : 'grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_40px]';

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

        <PostHeader post={post} zone={zone} leadRoles={leadRoles} titleRef={titleRef} canEdit={canEdit} />

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

        {post.attachments.length > 0 && <PostAttachmentsPanel attachments={post.attachments} className="mt-8 xl:hidden" />}

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
        </section>

        <RelatedPosts posts={related.filter((p) => p.id !== post.id)} className="cv-auto mt-12" />
      </article>

      <aside className="hidden xl:block">
        <PostRail band={band} post={post} authors={authors} leadRoles={leadRoles} articleRef={articleRef} />
      </aside>
    </div>
    </TranslatableScope>
  );
}
