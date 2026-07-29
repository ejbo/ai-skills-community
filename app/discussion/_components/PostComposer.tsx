'use client';

import { useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  FileText,
  ImagePlus,
  Link2,
  Loader2,
  Paperclip,
  Play,
  Video,
  X,
} from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { RichTextEditor } from '@/components/RichTextEditor';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import { formatBytes, type CurrentUser, type PostView } from './types';

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/gif';
const VIDEO_ACCEPT = 'video/mp4,video/webm,video/quicktime';
const FILE_ACCEPT = '.pdf,.ppt,.pptx,.doc,.docx';
const MAX_IMAGES = 9;
const MAX_FILES = 4;

interface UploadedItem {
  key: string;
  url: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

/** Raw-body upload protocol shared by every upload route in the app. */
function uploadRaw(
  file: File,
  endpoint: string,
  extraHeaders: Record<string, string>,
  onProgress?: (pct: number) => void,
): Promise<{ key: string; url: string; size: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', withBasePath(endpoint));
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
    for (const [k, v] of Object.entries(extraHeaders)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('bad_response'));
        }
      } else {
        let msg = 'upload_failed';
        try {
          msg = JSON.parse(xhr.responseText).error || msg;
        } catch {
          /* ignore */
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('network_error'));
    xhr.send(file);
  });
}

function uploadErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : '';
  if (msg === 'file_too_large') return '文件太大';
  if (msg === 'unsupported_type') return '不支持的文件类型';
  if (msg === 'rate_limited') return '上传过于频繁，请稍后再试';
  return '上传失败，请重试';
}

/**
 * The feed composer: a collapsed "分享你的想法…" trigger that expands into a
 * markdown editor with LinkedIn-style attachments — an image gallery, ONE
 * video (uploaded or external link — the intranet can't embed iframes, so
 * links render as cards), and PDF/PPT/Word files.
 */
export function PostComposer({
  currentUser,
  onPosted,
}: {
  currentUser: CurrentUser | null;
  onPosted: (post: PostView) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [bodyMd, setBodyMd] = useState('');
  const [images, setImages] = useState<UploadedItem[]>([]);
  const [video, setVideo] = useState<UploadedItem | null>(null);
  const [videoLink, setVideoLink] = useState('');
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');
  const [files, setFiles] = useState<UploadedItem[]>([]);
  const [uploading, setUploading] = useState(0); // in-flight upload count
  const [videoPct, setVideoPct] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function requireLogin(): boolean {
    if (currentUser) return true;
    pushToast('error', '请先登录');
    router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
    return false;
  }

  async function addImages(list: FileList | null) {
    if (!list) return;
    const room = MAX_IMAGES - images.length;
    const picked = Array.from(list).slice(0, room);
    if (Array.from(list).length > room) pushToast('info', `最多 ${MAX_IMAGES} 张图片`);
    for (const file of picked) {
      setUploading((n) => n + 1);
      try {
        const r = await uploadRaw(file, '/api/uploads/image', {});
        setImages((prev) =>
          prev.length >= MAX_IMAGES
            ? prev
            : [
                ...prev,
                {
                  key: r.key,
                  url: r.url,
                  name: file.name,
                  mimeType: file.type,
                  sizeBytes: r.size,
                },
              ],
        );
      } catch (e) {
        pushToast('error', `图片「${file.name}」${uploadErrorText(e)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  async function addVideo(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setUploading((n) => n + 1);
    setVideoPct(0);
    try {
      const r = await uploadRaw(file, '/api/discussion/upload', { 'x-upload-kind': 'video' }, (p) =>
        setVideoPct(p),
      );
      setVideo({ key: r.key, url: r.url, name: file.name, mimeType: file.type, sizeBytes: r.size });
      setVideoLink(''); // a post carries ONE video — upload replaces the link
      setLinkInputOpen(false);
    } catch (e) {
      pushToast('error', `视频${uploadErrorText(e)}`);
    } finally {
      setUploading((n) => n - 1);
      setVideoPct(null);
    }
  }

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const room = MAX_FILES - files.length;
    const picked = Array.from(list).slice(0, room);
    if (Array.from(list).length > room) pushToast('info', `最多 ${MAX_FILES} 个附件`);
    for (const file of picked) {
      setUploading((n) => n + 1);
      try {
        const r = await uploadRaw(file, '/api/discussion/upload', { 'x-upload-kind': 'file' });
        setFiles((prev) =>
          prev.length >= MAX_FILES
            ? prev
            : [
                ...prev,
                {
                  key: r.key,
                  url: r.url,
                  name: file.name,
                  mimeType: file.type,
                  sizeBytes: r.size,
                },
              ],
        );
      } catch (e) {
        pushToast('error', `附件「${file.name}」${uploadErrorText(e)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function confirmLink() {
    const raw = linkDraft.trim();
    if (!raw) return;
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      pushToast('error', '请输入完整的视频链接（含 https://）');
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      pushToast('error', '仅支持 http/https 链接');
      return;
    }
    setVideoLink(parsed.toString());
    setVideo(null); // ONE video per post
    setLinkDraft('');
    setLinkInputOpen(false);
  }

  function reset() {
    setBodyMd('');
    setImages([]);
    setVideo(null);
    setVideoLink('');
    setLinkDraft('');
    setLinkInputOpen(false);
    setFiles([]);
  }

  async function submit() {
    const trimmed = bodyMd.trim();
    const mediaCount = images.length + files.length + (video ? 1 : 0) + (videoLink ? 1 : 0);
    if (!trimmed && mediaCount === 0) {
      pushToast('error', '说点什么，或附上图片 / 视频 / 文件');
      return;
    }
    if (busy || uploading > 0) return;
    setBusy(true);
    try {
      const media = [
        ...images.map((m) => ({
          kind: 'image' as const,
          key: m.key,
          name: m.name,
          mimeType: m.mimeType,
          sizeBytes: m.sizeBytes,
        })),
        ...(video
          ? [
              {
                kind: 'video' as const,
                key: video.key,
                name: video.name,
                mimeType: video.mimeType,
                sizeBytes: video.sizeBytes,
              },
            ]
          : []),
        ...(videoLink ? [{ kind: 'video_link' as const, url: videoLink }] : []),
        ...files.map((m) => ({
          kind: 'file' as const,
          key: m.key,
          name: m.name,
          mimeType: m.mimeType,
          sizeBytes: m.sizeBytes,
        })),
      ];
      const res = await fetch('/api/discussion/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bodyMd: trimmed, media }),
      });
      if (res.status === 401) {
        pushToast('error', '请先登录');
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data.reason ?? '发布失败，请重试');
        return;
      }
      pushToast('success', '已发布');
      onPosted(data.post as PostView);
      reset();
      setOpen(false);
    } catch {
      pushToast('error', '发布失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="surface flex items-center gap-3 rounded-2xl p-4">
        <Avatar
          name={currentUser?.displayName ?? '游客'}
          src={currentUser?.avatarUrl}
          size="md"
          tone="subtle"
        />
        <button
          onClick={() => {
            if (requireLogin()) setOpen(true);
          }}
          className="h-11 flex-1 rounded-full border border-zinc-200 bg-zinc-50 px-4 text-left text-sm text-muted transition hover:border-accent-400 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-900/60"
        >
          分享你的想法、动态或资源…
        </button>
      </div>
    );
  }

  const attachBtn =
    'flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800';

  return (
    <div className="surface space-y-3 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Avatar
            name={currentUser?.displayName ?? ''}
            src={currentUser?.avatarUrl}
            size="sm"
            tone="subtle"
          />
          <span className="text-sm font-medium">{currentUser?.displayName}</span>
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label="收起"
          className="rounded p-1 text-muted hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <RichTextEditor
        value={bodyMd}
        onChange={setBodyMd}
        variant="compact"
        maxLength={8000}
        placeholder="分享你的想法、动态或资源…"
        ariaLabel="动态正文"
        autoFocus
      />

      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((m) => (
            <div key={m.key} className="relative h-20 w-20 overflow-hidden rounded-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={withBasePath(m.url)} alt="" className="h-full w-full object-cover" />
              <button
                onClick={() => setImages((prev) => prev.filter((x) => x.key !== m.key))}
                aria-label="移除图片"
                className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {videoPct !== null && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            视频上传中 {Math.round(videoPct)}%
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div className="h-full bg-accent-500 transition-all" style={{ width: `${videoPct}%` }} />
          </div>
        </div>
      )}

      {video && (
        <div className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-800">
            <Play className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{video.name}</span>
            <span className="block text-xs text-muted">{formatBytes(video.sizeBytes)}</span>
          </span>
          <button
            onClick={() => setVideo(null)}
            aria-label="移除视频"
            className="rounded p-1 text-muted hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {videoLink && (
        <div className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <Link2 className="h-4 w-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate text-sm">{videoLink}</span>
          <button
            onClick={() => setVideoLink('')}
            aria-label="移除链接"
            className="rounded p-1 text-muted hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((m) => (
            <div
              key={m.key}
              className="flex items-center gap-3 rounded-xl border border-zinc-200 p-2.5 dark:border-zinc-800"
            >
              <FileText className="h-4 w-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
              <span className="shrink-0 text-xs text-muted">{formatBytes(m.sizeBytes)}</span>
              <button
                onClick={() => setFiles((prev) => prev.filter((x) => x.key !== m.key))}
                aria-label="移除附件"
                className="rounded p-1 text-muted hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {linkInputOpen && (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && confirmLink()}
            placeholder="粘贴外部视频链接（内网无法内嵌播放，将显示为链接卡片）"
            className="h-9 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          />
          <button
            onClick={confirmLink}
            className="h-9 rounded-lg bg-accent-500 px-3 text-sm font-medium text-white hover:bg-accent-600"
          >
            添加
          </button>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
        <div className="flex items-center gap-1">
          <input
            ref={imageInput}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              void addImages(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={videoInput}
            type="file"
            accept={VIDEO_ACCEPT}
            hidden
            onChange={(e) => {
              void addVideo(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={fileInput}
            type="file"
            accept={FILE_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => imageInput.current?.click()}
            disabled={images.length >= MAX_IMAGES}
            className={attachBtn}
            title="图片（最多 9 张）"
          >
            <ImagePlus className="h-4 w-4" />
            图片
          </button>
          <button
            onClick={() => videoInput.current?.click()}
            disabled={Boolean(video) || uploading > 0}
            className={attachBtn}
            title="上传视频（可直接在动态里播放）"
          >
            <Video className="h-4 w-4" />
            视频
          </button>
          <button
            onClick={() => setLinkInputOpen((v) => !v)}
            disabled={Boolean(videoLink)}
            className={attachBtn}
            title="外部视频链接"
          >
            <Link2 className="h-4 w-4" />
            链接
          </button>
          <button
            onClick={() => fileInput.current?.click()}
            disabled={files.length >= MAX_FILES}
            className={attachBtn}
            title="PDF / PPT / Word 附件"
          >
            <Paperclip className="h-4 w-4" />
            附件
          </button>
        </div>
        <button
          onClick={submit}
          disabled={busy || uploading > 0}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-5 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-60"
        >
          {(busy || uploading > 0) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          发布
        </button>
      </div>
    </div>
  );
}
