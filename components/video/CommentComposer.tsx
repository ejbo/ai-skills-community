'use client';

// 评论 composer, 抖音-style lightweight by default: a single auto-growing
// textarea in a pill (Enter 发送, Shift+Enter 换行) with 图片 / 表情包 buttons
// appending markdown, and a SMALL round send button. The full RichTextEditor
// is behind an explicit toggle — most comments are one line of text.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { currentLoginHref } from '@/lib/auth/callback-path';
import { Image as ImageIcon, Loader2, Pilcrow, Send, Smile } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import { RichTextEditor } from '@/components/RichTextEditor';
import { StickerPicker } from '@/components/stickers/StickerPicker';
import { withBasePath } from '@/lib/base-path';
import type { VideoCommentView } from '@/lib/video/queries';

async function uploadImage(file: File): Promise<string | null> {
  try {
    const res = await fetch(withBasePath('/api/uploads/image'), {
      method: 'POST',
      headers: {
        'content-type': file.type,
        'x-filename': encodeURIComponent(file.name),
      },
      body: file,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string };
    return typeof data.url === 'string' ? data.url : null;
  } catch {
    return null;
  }
}

interface Props {
  slug: string;
  parentId?: string;
  // The specific comment being answered (used when replying to a reply, so the
  // right person gets the "your reply was replied to" notification). DB threading
  // stays flat — parentId is always the thread root.
  replyToId?: string;
  onPosted: (comment: VideoCommentView) => void;
  autoFocus?: boolean;
}

export function CommentComposer({ slug, parentId, replyToId, onPosted, autoFocus }: Props) {
  const t = useTranslations('video');
  const tu = useTranslations('video_ui');
  const router = useRouter();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [rich, setRich] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const stickerBtnRef = useRef<HTMLButtonElement | null>(null);

  function appendMd(md: string) {
    setBody((b) => (b.trim() ? `${b}\n${md}` : md));
  }

  function autoGrow() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }

  async function pickImage(list: FileList | null) {
    const f = list?.[0];
    if (!f || uploadingImg) return;
    setUploadingImg(true);
    const url = await uploadImage(f);
    setUploadingImg(false);
    if (url) appendMd(`![](${url})`);
    else pushToast('error', tu('post_failed'));
  }

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/videos/${slug}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bodyMd: trimmed,
          ...(parentId ? { parentId } : {}),
          ...(replyToId ? { replyToId } : {}),
        }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          pushToast('info', t('login_required'));
          router.push(currentLoginHref());
          return;
        }
        pushToast('error', tu('post_failed'));
        return;
      }
      const data = await res.json();
      if (data.comment) {
        onPosted(data.comment as VideoCommentView);
        setBody('');
        if (taRef.current) taRef.current.style.height = 'auto';
      }
    } catch {
      pushToast('error', tu('post_failed'));
    } finally {
      setSending(false);
    }
  }

  const iconBtn =
    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:text-zinc-700 active:scale-90 dark:hover:text-zinc-200';

  return (
    <div>
      <div className="flex items-end gap-2">
        {rich ? (
          <div className="min-w-0 flex-1">
            <RichTextEditor
              value={body}
              onChange={setBody}
              variant="compact"
              maxLength={2000}
              autoFocus
              placeholder={t('comments.placeholder')}
              ariaLabel={t('comments.placeholder')}
            />
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-end gap-0.5 rounded-2xl bg-zinc-100 py-1.5 pl-3.5 pr-1.5 dark:bg-zinc-800/70">
            <textarea
              ref={taRef}
              rows={1}
              value={body}
              autoFocus={autoFocus}
              maxLength={2000}
              onChange={(e) => {
                setBody(e.target.value);
                autoGrow();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder={t('comments.placeholder')}
              aria-label={t('comments.placeholder')}
              className="min-h-[26px] w-full resize-none self-center bg-transparent py-0.5 text-sm outline-none placeholder:text-zinc-400"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploadingImg || sending}
              className={iconBtn}
              title={tu('attach_image')}
              aria-label={tu('attach_image')}
            >
              {uploadingImg ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImageIcon className="h-4 w-4" />
              )}
            </button>
            <button
              ref={stickerBtnRef}
              type="button"
              onClick={() => setStickerOpen((v) => !v)}
              disabled={sending}
              className={iconBtn}
              title={tu('sticker')}
              aria-label={tu('sticker')}
            >
              <Smile className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setRich(true)}
              disabled={sending}
              className={iconBtn}
              title={tu('rich_on')}
              aria-label={tu('rich_on')}
            >
              <Pilcrow className="h-4 w-4" />
            </button>
          </div>
        )}
        <button
          onClick={submit}
          disabled={sending || !body.trim() || body.length > 2000}
          className="flex h-8 w-8 shrink-0 items-center justify-center self-end rounded-full bg-zinc-900 text-white transition hover:bg-zinc-700 active:scale-90 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          title={t('comments.post')}
          aria-label={t('comments.post')}
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </button>
      </div>
      {rich && (
        <button
          type="button"
          onClick={() => setRich(false)}
          className="mt-1.5 text-xs font-medium text-zinc-400 underline-offset-2 transition hover:text-zinc-600 hover:underline dark:hover:text-zinc-300"
        >
          {tu('rich_off')}
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void pickImage(e.target.files);
          e.target.value = '';
        }}
      />
      <StickerPicker
        open={stickerOpen}
        anchor={stickerBtnRef.current}
        onClose={() => setStickerOpen(false)}
        onSelect={(s) => {
          appendMd(`![](${s.url})`);
          setStickerOpen(false);
        }}
      />
    </div>
  );
}
