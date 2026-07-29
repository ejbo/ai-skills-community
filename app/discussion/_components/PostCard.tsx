'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { formatDistanceToNowStrict } from 'date-fns';
import {
  ExternalLink,
  Link2,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { RichTextEditor } from '@/components/RichTextEditor';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import { copyText } from '@/lib/clipboard';
import { PostMediaGallery } from './PostMediaGallery';
import { PostComments } from './PostComments';
import { PinnedBadge } from './badges';
import type { CurrentUser, PostView } from './types';

/**
 * One feed post — LinkedIn-style card: author row, clamped body with 展开,
 * media gallery, like/comment/share actions and an inline comment section.
 * In `detail` mode (the shareable /discussion/posts/<id> page) the body is
 * unclamped and comments are open by default.
 */
export function PostCard({
  post,
  currentUser,
  detail = false,
  focusId,
  onRemoved,
}: {
  post: PostView;
  currentUser: CurrentUser | null;
  detail?: boolean;
  focusId?: string;
  onRemoved?: (id: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [liked, setLiked] = useState(post.likedByMe);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [likeBusy, setLikeBusy] = useState(false);
  const [commentCount, setCommentCount] = useState(post.commentCount);
  const [commentsOpen, setCommentsOpen] = useState(detail);
  const [expanded, setExpanded] = useState(detail);
  const [overflowing, setOverflowing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pinned, setPinned] = useState(post.pinned);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(post.bodyMd);
  const [bodyMd, setBodyMd] = useState(post.bodyMd);
  const [editedAt, setEditedAt] = useState(post.editedAt);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isAuthor = currentUser?.handle === post.author.handle;
  const isAdmin = Boolean(currentUser?.isAdmin);
  // LinkedIn's clamp split: fewer lines when the card also carries media.
  const clampMax = post.media.length > 0 ? '5.5rem' : '9rem';

  // Show 展开 only when the body actually overflows the clamp.
  useEffect(() => {
    if (expanded || !bodyRef.current) return;
    const el = bodyRef.current;
    setOverflowing(el.scrollHeight > el.clientHeight + 2);
  }, [expanded, bodyMd]);

  useEffect(() => {
    if (!menuOpen) return;
    function close(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  async function toggleLike() {
    if (likeBusy) return;
    setLikeBusy(true);
    const prev = { liked, likeCount };
    setLiked(!liked);
    setLikeCount(likeCount + (liked ? -1 : 1));
    try {
      const res = await fetch(`/api/discussion/posts/${post.id}/like`, { method: 'POST' });
      if (res.status === 401) {
        setLiked(prev.liked);
        setLikeCount(prev.likeCount);
        pushToast('error', '请先登录再点赞');
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('failed');
      setLiked(Boolean(data.liked));
      setLikeCount(typeof data.likeCount === 'number' ? data.likeCount : prev.likeCount);
    } catch {
      setLiked(prev.liked);
      setLikeCount(prev.likeCount);
      pushToast('error', '操作失败，请重试');
    } finally {
      setLikeBusy(false);
    }
  }

  async function share() {
    const url = `${window.location.origin}${withBasePath(`/discussion/posts/${post.id}`)}`;
    const ok = await copyText(url);
    pushToast(ok ? 'success' : 'error', ok ? '链接已复制' : '复制失败');
  }

  async function togglePin() {
    setMenuOpen(false);
    const next = !pinned;
    const res = await fetch(`/api/discussion/posts/${post.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pinned: next }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      pushToast('error', data.reason ?? '操作失败');
      return;
    }
    setPinned(next);
    pushToast('success', next ? '已置顶' : '已取消置顶');
    router.refresh();
  }

  async function saveEdit() {
    const trimmed = editDraft.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/discussion/posts/${post.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bodyMd: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data.reason ?? '保存失败');
        return;
      }
      setBodyMd(trimmed);
      setEditedAt(data.post?.editedAt ?? new Date().toISOString());
      setEditing(false);
      pushToast('success', '已更新');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setMenuOpen(false);
    if (!confirm('确定删除这条动态？所有评论和点赞会一并删除。')) return;
    const res = await fetch(`/api/discussion/posts/${post.id}`, { method: 'DELETE' });
    if (!res.ok) {
      pushToast('error', '删除失败');
      return;
    }
    pushToast('success', '已删除');
    if (detail) {
      router.push('/discussion');
      router.refresh();
    } else {
      onRemoved?.(post.id);
    }
  }

  const actionBtn =
    'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition hover:bg-zinc-100 dark:hover:bg-zinc-800';

  return (
    <article className="surface rounded-2xl p-4">
      {/* Author row */}
      <div className="flex items-start gap-3">
        <Link href={`/users/${post.author.handle}`} className="shrink-0">
          <Avatar name={post.author.displayName} src={post.author.avatarUrl} size="md" tone="subtle" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/users/${post.author.handle}`}
              className="truncate text-sm font-semibold hover:underline"
            >
              {post.author.displayName}
            </Link>
            <DeptTag department={post.author.department} lab={post.author.lab} />
            {pinned && <PinnedBadge />}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            {!post.author.isPrivate && (
              <>
                <span>@{post.author.handle}</span>
                <span>·</span>
              </>
            )}
            <span>{formatDistanceToNowStrict(new Date(post.createdAt), { addSuffix: true })}</span>
            {editedAt && <span>· 已编辑</span>}
          </div>
        </div>
        <div ref={menuRef} className="relative shrink-0">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="更多操作"
            className="rounded-lg p-1.5 text-muted transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div className="surface absolute right-0 top-full z-30 mt-1 w-44 rounded-xl p-1 shadow-lg">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  void share();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <Link2 className="h-4 w-4" />
                复制链接
              </button>
              {!detail && (
                <a
                  href={withBasePath(`/discussion/posts/${post.id}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <ExternalLink className="h-4 w-4" />
                  在新标签页打开
                </a>
              )}
              {isAuthor && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setEditDraft(bodyMd);
                    setEditing(true);
                    setExpanded(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Pencil className="h-4 w-4" />
                  编辑
                </button>
              )}
              {isAdmin && (
                <button
                  onClick={togglePin}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                  {pinned ? '取消置顶' : '置顶'}
                </button>
              )}
              {(isAuthor || isAdmin) && (
                <button
                  onClick={remove}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-danger transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Trash2 className="h-4 w-4" />
                  删除
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      {editing ? (
        <div className="mt-3 space-y-2">
          <RichTextEditor
            value={editDraft}
            onChange={setEditDraft}
            variant="compact"
            maxLength={8000}
            ariaLabel="编辑动态"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              className="h-8 rounded-lg px-3 text-xs font-medium text-muted transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              取消
            </button>
            <button
              onClick={saveEdit}
              disabled={busy || !editDraft.trim()}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-xs font-medium text-white hover:bg-accent-600 disabled:opacity-60"
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              保存
            </button>
          </div>
        </div>
      ) : (
        bodyMd && (
          <div className="mt-3">
            <div
              ref={bodyRef}
              className="overflow-hidden"
              style={expanded ? undefined : { maxHeight: clampMax }}
            >
              <MarkdownRenderer content={bodyMd} compact />
            </div>
            {!expanded && overflowing && (
              <button
                onClick={() => setExpanded(true)}
                className="mt-1 text-sm font-medium text-muted transition hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                …展开
              </button>
            )}
          </div>
        )
      )}

      {/* Media */}
      <PostMediaGallery media={post.media} />

      {/* Stats */}
      {(likeCount > 0 || commentCount > 0) && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted">
          <span className="flex items-center gap-1">
            {likeCount > 0 && (
              <>
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent-500 text-white">
                  <ThumbsUp className="h-2.5 w-2.5" />
                </span>
                {likeCount}
              </>
            )}
          </span>
          {commentCount > 0 && (
            <button onClick={() => setCommentsOpen((v) => !v)} className="hover:underline">
              {commentCount} 条评论
            </button>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-2 flex items-center gap-1 border-t border-zinc-100 pt-2 dark:border-zinc-800/60">
        <button
          onClick={toggleLike}
          disabled={likeBusy}
          aria-pressed={liked}
          className={`${actionBtn} ${
            liked ? 'text-accent-600 dark:text-accent-300' : 'text-zinc-600 dark:text-zinc-300'
          }`}
        >
          <ThumbsUp className={`h-4 w-4 ${liked ? 'fill-current' : ''}`} />
          {liked ? '已赞' : '点赞'}
        </button>
        <button
          onClick={() => setCommentsOpen((v) => !v)}
          className={`${actionBtn} text-zinc-600 dark:text-zinc-300`}
        >
          <MessageSquare className="h-4 w-4" />
          评论
        </button>
        <button onClick={share} className={`${actionBtn} text-zinc-600 dark:text-zinc-300`}>
          <Link2 className="h-4 w-4" />
          分享
        </button>
      </div>

      {/* Comments */}
      {commentsOpen && (
        <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
          <PostComments
            postId={post.id}
            currentUser={currentUser}
            focusId={focusId}
            onCountChange={(delta) => setCommentCount((n) => Math.max(0, n + delta))}
          />
        </div>
      )}
    </article>
  );
}
