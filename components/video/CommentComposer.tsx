'use client';

// 评论 composer, 抖音-style lightweight by default: a single auto-growing
// textarea in a pill (Enter 发送, Shift+Enter 换行) with 图片 / 表情包 buttons
// appending markdown, and a SMALL round send button. The full RichTextEditor
// is behind an explicit toggle — most comments are one line of text.
//
// Leaving 富文本 is guarded. The simple box is markdown-native, so `**bold**`
// or a table written as pipes survives the switch as the author wrote it; HTML
// does not — the editor stores colours / sizes as `<span data-color="red">`,
// resized images as `<img width>`, line breaks inside table cells as `<br>`.
// Switching used to drop all of that into the textarea as raw tags. Now:
//   • only formatting spans ⇒ 「清除格式并切换」 (stripRichFormatting keeps the
//     text) or stay;
//   • any other markup ⇒ 「仍然切换」 (content kept byte-for-byte, shown as
//     source — posting it still renders correctly) or stay.
// A body with no HTML switches immediately, exactly as before.
//
// Focus follows the choice: the question takes focus when it appears (it
// replaces the focused 返回简洁输入 button — without this, focus fell to <body>
// and a keyboard user had to tab back from the top of the page), 继续使用富文本
// returns to the editor, and a switch lands in the textarea with the caret at
// the end.

import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useRouter } from 'next/navigation';
import { currentLoginHref } from '@/lib/auth/callback-path';
import { Image as ImageIcon, Loader2, Pilcrow, Send, Smile } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import { RichTextEditor } from '@/components/RichTextEditor';
import { htmlMarkupIn, isRichTextTooLong, stripRichFormatting } from '@/lib/markdown-text';
import { uploadContentTypeFor } from '@/lib/files/file-types';
import { StickerPicker } from '@/components/stickers/StickerPicker';
import { withBasePath } from '@/lib/base-path';
import type { VideoCommentView } from '@/lib/video/queries';

async function uploadImage(file: File): Promise<string | null> {
  try {
    const res = await fetch(withBasePath('/api/uploads/image'), {
      method: 'POST',
      headers: {
        // The extension's type when the OS reported none (a `.png` with an empty type would 415).
        'content-type': uploadContentTypeFor(file),
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
  // The 富文本 → 简洁输入 confirmation is open (see the header).
  const [confirmPlain, setConfirmPlain] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  // Set by a 富文本 → 简洁输入 switch only, so the first mount never steals focus.
  const focusTextareaRef = useRef(false);
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

  // A multi-line body coming back from the rich editor must not sit in a one-row textarea.
  useEffect(() => {
    if (!rich) autoGrow();
    if (!rich && focusTextareaRef.current) {
      focusTextareaRef.current = false;
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rich]);

  function toPlain(strip: boolean) {
    if (strip) setBody((b) => stripRichFormatting(b));
    setConfirmPlain(false);
    focusTextareaRef.current = true;
    setRich(false);
  }

  function stayRich() {
    setConfirmPlain(false);
    editorRef.current?.commands.focus();
  }

  function requestPlain() {
    const markup = htmlMarkupIn(body);
    if (!markup.formatting && !markup.other) toPlain(false);
    else setConfirmPlain(true);
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
        setConfirmPlain(false);
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
              editorRef={editorRef}
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
          disabled={sending || !body.trim() || isRichTextTooLong(body, 2000)}
          className="flex h-8 w-8 shrink-0 items-center justify-center self-end rounded-full bg-zinc-900 text-white transition hover:bg-zinc-700 active:scale-90 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          title={t('comments.post')}
          aria-label={t('comments.post')}
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </button>
      </div>
      {rich && (
        <PlainSwitch
          body={body}
          confirming={confirmPlain}
          onRequest={requestPlain}
          onConfirm={toPlain}
          onCancel={stayRich}
        />
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

/**
 * The 返回简洁输入 link, or — while `confirming` — the question that replaces
 * it. The markup is re-read every render: editing while the question is open
 * (deleting the coloured word) can make it moot, and then the plain link is back.
 */
function PlainSwitch({
  body,
  confirming,
  onRequest,
  onConfirm,
  onCancel,
}: {
  body: string;
  confirming: boolean;
  onRequest: () => void;
  /** `strip` = remove the formatting spans first. */
  onConfirm: (strip: boolean) => void;
  onCancel: () => void;
}) {
  const tu = useTranslations('video_ui');
  const markup = confirming ? htmlMarkupIn(body) : null;
  const asking = Boolean(markup && (markup.formatting || markup.other));
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  // The question replaces the (focused) link: hand focus to its primary action.
  useEffect(() => {
    if (asking) primaryRef.current?.focus();
  }, [asking]);
  const link = 'text-xs font-medium underline-offset-2 transition hover:underline';
  if (!markup || !asking) {
    return (
      <button type="button" onClick={onRequest} className={`mt-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 ${link}`}>
        {tu('rich_off')}
      </button>
    );
  }
  return (
    <div role="alert" className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="text-zinc-500 dark:text-zinc-400">{markup.other ? tu('rich_off_markup_note') : tu('rich_off_formatting_note')}</span>
      <button ref={primaryRef} type="button" onClick={() => onConfirm(!markup.other)} className={`text-zinc-900 dark:text-zinc-100 ${link}`}>
        {markup.other ? tu('rich_off_anyway') : tu('rich_off_strip')}
      </button>
      <button type="button" onClick={onCancel} className={`text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 ${link}`}>
        {tu('rich_off_stay')}
      </button>
    </div>
  );
}
