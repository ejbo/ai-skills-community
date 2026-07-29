'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Play,
  Presentation,
  X,
} from 'lucide-react';
import { withBasePath } from '@/lib/base-path';
import { formatBytes, type MediaView } from './types';

// Renders a post's attachments below the body text:
// - images  → count-aware grid (1 full / 2 half / 3 = 1+2 / 4 = 2×2 / 5+ = "+N"
//             overlay) opening a same-origin lightbox — intranet-safe, no CDN.
// - video   → inline <video> player (self-hosted upload; same-origin Range route).
// - video_link → link card opening in a new tab (external iframes are blocked
//             on the intranet, so we never embed).
// - file    → document rows; PDF opens inline in a new tab (browser viewer),
//             PPT/Word downloads with the original filename.
export function PostMediaGallery({ media }: { media: MediaView[] }) {
  const images = media.filter((m) => m.kind === 'image');
  const video = media.find((m) => m.kind === 'video') ?? null;
  const videoLink = media.find((m) => m.kind === 'video_link') ?? null;
  const files = media.filter((m) => m.kind === 'file');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (media.length === 0) return null;

  return (
    <div className="mt-3 space-y-3">
      {images.length > 0 && (
        <ImageGrid images={images} onOpen={(i) => setLightboxIndex(i)} />
      )}

      {video && (
        <div className="overflow-hidden rounded-xl bg-black">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            controls
            preload="metadata"
            playsInline
            poster={withBasePath(video.posterUrl) || undefined}
            src={withBasePath(video.url)}
            className="aspect-video w-full"
          />
        </div>
      )}

      {videoLink && <VideoLinkCard media={videoLink} />}

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f) => (
            <FileCard key={f.id} media={f} />
          ))}
        </div>
      )}

      {lightboxIndex !== null && (
        <Lightbox
          images={images}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </div>
  );
}

function ImageGrid({ images, onOpen }: { images: MediaView[]; onOpen: (i: number) => void }) {
  const count = images.length;
  const shown = images.slice(0, 4);
  const extra = count - 4;

  function tile(m: MediaView, i: number, className: string, overlay?: number) {
    return (
      <button
        key={m.id}
        onClick={() => onOpen(i)}
        className={`relative block overflow-hidden bg-zinc-100 dark:bg-zinc-900 ${className}`}
        aria-label={`查看图片 ${i + 1}/${count}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={withBasePath(m.url)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition duration-300 hover:scale-[1.02]"
        />
        {overlay != null && overlay > 0 && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-2xl font-semibold text-white">
            +{overlay}
          </span>
        )}
      </button>
    );
  }

  if (count === 1) {
    return (
      <div className="overflow-hidden rounded-xl">
        {tile(images[0], 0, 'max-h-[480px] w-full')}
      </div>
    );
  }
  if (count === 2) {
    return (
      <div className="grid grid-cols-2 gap-1 overflow-hidden rounded-xl">
        {shown.map((m, i) => tile(m, i, 'aspect-square'))}
      </div>
    );
  }
  if (count === 3) {
    return (
      <div className="grid h-72 grid-cols-3 gap-1 overflow-hidden rounded-xl">
        {tile(images[0], 0, 'col-span-2 h-72')}
        <div className="grid grid-rows-2 gap-1">
          {tile(images[1], 1, 'h-full min-h-0')}
          {tile(images[2], 2, 'h-full min-h-0')}
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-1 overflow-hidden rounded-xl">
      {shown.map((m, i) => tile(m, i, 'aspect-[4/3]', i === 3 ? extra : undefined))}
    </div>
  );
}

function Lightbox({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: MediaView[];
  index: number;
  onClose: () => void;
  onNavigate: (i: number) => void;
}) {
  const count = images.length;
  const prev = useCallback(
    () => onNavigate((index - 1 + count) % count),
    [index, count, onNavigate],
  );
  const next = useCallback(() => onNavigate((index + 1) % count), [index, count, onNavigate]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, prev, next]);

  const current = images[index];
  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
    >
      <button
        onClick={onClose}
        aria-label="关闭"
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>
      {count > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            prev();
          }}
          aria-label="上一张"
          className="absolute left-4 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={withBasePath(current.url)}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] max-w-[92vw] rounded-lg object-contain"
      />
      {count > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
          aria-label="下一张"
          className="absolute right-4 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}
      {count > 1 && (
        <div className="absolute bottom-5 flex gap-1.5">
          {images.map((m, i) => (
            <button
              key={m.id}
              onClick={(e) => {
                e.stopPropagation();
                onNavigate(i);
              }}
              aria-label={`第 ${i + 1} 张`}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? 'w-5 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function VideoLinkCard({ media }: { media: MediaView }) {
  return (
    <a
      href={media.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3 transition hover:border-accent-500 dark:border-zinc-800 dark:hover:border-accent-400"
    >
      <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-800">
        <Play className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {media.name || domainOf(media.url)}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted">
          {domainOf(media.url)} · 外部视频，在新窗口打开
        </span>
      </span>
      <ExternalLink className="h-4 w-4 shrink-0 text-muted" />
    </a>
  );
}

function fileMeta(m: MediaView): { label: string; className: string; inline: boolean } {
  const ext = (m.name.split('.').pop() ?? '').toLowerCase();
  const fromUrl = (m.url.split('.').pop() ?? '').toLowerCase();
  const kind = ext || fromUrl;
  if (kind === 'pdf') return { label: 'PDF', className: 'bg-rose-500/10 text-rose-600 dark:text-rose-400', inline: true };
  if (kind === 'ppt' || kind === 'pptx')
    return { label: 'PPT', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', inline: false };
  return { label: 'DOC', className: 'bg-sky-500/10 text-sky-600 dark:text-sky-400', inline: false };
}

function FileCard({ media }: { media: MediaView }) {
  const meta = fileMeta(media);
  // Non-inline files carry the original name so the download keeps it.
  const href = withBasePath(
    meta.inline ? media.url : `${media.url}?name=${encodeURIComponent(media.name || 'attachment')}`,
  );
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3 transition hover:border-accent-500 dark:border-zinc-800 dark:hover:border-accent-400"
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${meta.className}`}
      >
        {meta.label === 'PPT' ? (
          <Presentation className="h-5 w-5" />
        ) : (
          <FileText className="h-5 w-5" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{media.name || meta.label}</span>
        <span className="mt-0.5 block text-xs text-muted">
          {meta.label}
          {media.sizeBytes > 0 ? ` · ${formatBytes(media.sizeBytes)}` : ''}
          {meta.inline ? ' · 点击预览' : ' · 点击下载'}
        </span>
      </span>
    </a>
  );
}
