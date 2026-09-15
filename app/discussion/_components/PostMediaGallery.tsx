'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Play,
  X,
} from 'lucide-react';
import { fileIconFor } from '@/components/files/file-icon';
import { withBasePath } from '@/lib/base-path';
import { fileDownloadHref, fileMetaParts } from '@/lib/files/display';
import { previewPlanFor } from '@/lib/files/file-types';
import { FileViewerDrawer } from './FileViewerDrawer';
import {
  discussionFileExt,
  discussionFileTarget,
  fileTileClass,
  isDownloadOnlyFile,
  type DiscussionFileTarget,
} from './file-attachments';
import type { MediaView } from './types';

// Renders a post's attachments below the body text:
// - images  → count-aware grid (1 full / 2 half / 3 = 1+2 / 4 = 2×2 / 5+ = "+N"
//             overlay) opening a same-origin lightbox — intranet-safe, no CDN.
// - video   → inline <video> player (self-hosted upload; same-origin Range route).
// - video_link → link card opening in a new tab (external iframes are blocked
//             on the intranet, so we never embed).
// - file    → rows of ANY file type. The row opens the shared FileViewer in a
//             modal drawer (code / json / csv / markdown / pdf / media preview in
//             place; everything else is the viewer's 不支持预览 card with 下载),
//             and a separate ↓ link downloads without opening anything. Types
//             the viewer cannot render say 仅下载 on the row before it is opened.
export function PostMediaGallery({ media }: { media: MediaView[] }) {
  const images = media.filter((m) => m.kind === 'image');
  const video = media.find((m) => m.kind === 'video') ?? null;
  const videoLink = media.find((m) => m.kind === 'video_link') ?? null;
  const files = media.filter((m) => m.kind === 'file');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [openFile, setOpenFile] = useState<DiscussionFileTarget | null>(null);

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
            <FileCard key={f.id} media={f} onOpen={setOpenFile} />
          ))}
        </div>
      )}

      {files.length > 0 && <FileViewerDrawer file={openFile} onClose={() => setOpenFile(null)} />}

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
  const t = useTranslations('discussion_ui');
  const count = images.length;
  // LinkedIn mosaic: up to 5 visible tiles; beyond that the LAST tile carries a
  // "+N" overlay and opens the lightbox at the first hidden image, whose ←/→
  // arrows and dots then reach every remaining image.
  const shown = images.slice(0, 5);
  const extra = count - 5;

  function tile(m: MediaView, i: number, className: string, overlay?: number, openAt?: number) {
    return (
      <button
        key={m.id}
        // The "+N" overlay tile jumps to the first HIDDEN image, not itself.
        onClick={() => onOpen(openAt ?? i)}
        className={`relative block overflow-hidden bg-zinc-100 dark:bg-zinc-900 ${className}`}
        aria-label={t('view_image_n', { index: (openAt ?? i) + 1, total: count })}
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
  if (count === 4) {
    return (
      <div className="grid grid-cols-2 gap-1 overflow-hidden rounded-xl">
        {shown.map((m, i) => tile(m, i, 'aspect-[4/3]'))}
      </div>
    );
  }
  // 5+ — LinkedIn's 2-on-top / 3-below mosaic; every image stays reachable.
  return (
    <div className="overflow-hidden rounded-xl">
      <div className="grid grid-cols-2 gap-1">
        {shown.slice(0, 2).map((m, i) => tile(m, i, 'aspect-[4/3]'))}
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1">
        {shown.slice(2).map((m, i) => {
          const isOverlay = i + 2 === 4 && extra > 0;
          return tile(
            m,
            i + 2,
            'aspect-[4/3]',
            isOverlay ? extra : undefined,
            isOverlay ? 5 : undefined,
          );
        })}
      </div>
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
  const t = useTranslations('discussion_ui');
  const tc = useTranslations('common');
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
      aria-label={t('image_preview')}
    >
      <button
        onClick={onClose}
        aria-label={tc('dismiss')}
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
          aria-label={t('prev_image')}
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
          aria-label={t('next_image')}
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
              aria-label={t('image_dot_n', { index: i + 1 })}
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
  const t = useTranslations('discussion_ui');
  return (
    <a
      href={media.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3 transition hover:border-zinc-400 dark:hover:border-zinc-500 dark:border-zinc-800"
    >
      <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-800">
        <Play className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {media.name || domainOf(media.url)}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted">
          {domainOf(media.url)} · {t('external_video_new_tab')}
        </span>
      </span>
      <ExternalLink className="h-4 w-4 shrink-0 text-muted" />
    </a>
  );
}

function FileCard({ media, onOpen }: { media: MediaView; onOpen: (target: DiscussionFileTarget) => void }) {
  const t = useTranslations('discussion_ui');
  const tz = useTranslations('zones');
  const target = discussionFileTarget(media);
  const name = media.name || 'attachment';
  const downloadHref = fileDownloadHref(media.url, name);
  const rowClass =
    'flex items-center gap-1 rounded-xl border border-zinc-200 transition hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-500';

  // A URL that is not a post-media key (should not exist) keeps the old
  // behaviour: a plain download link, never a viewer guessing at the bytes.
  if (!target) {
    return (
      <a href={downloadHref} className={`${rowClass} gap-3 p-3`}>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${fileTileClass('')}`}>
          <Download className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
      </a>
    );
  }

  const ext = discussionFileExt(target, media.mimeType);
  const Icon = fileIconFor(previewPlanFor(target.storageKey, target.name).cls, ext);
  const downloadOnly = isDownloadOnlyFile(target.storageKey, target.name);
  const meta = fileMetaParts(ext, media.sizeBytes, tz('attach_type_generic')).join(' · ');

  return (
    <div className={rowClass}>
      <button
        type="button"
        onClick={() => onOpen(target)}
        aria-haspopup="dialog"
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
      >
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${fileTileClass(ext)}`}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium" title={name}>
            {name}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
            <span className="font-mono text-[11px] tabular-nums">{meta}</span>
            {downloadOnly ? (
              <span className="rounded-full border border-zinc-300 px-1.5 py-px text-[10px] dark:border-zinc-700">
                {tz('attach_download_only')}
              </span>
            ) : (
              <span>{t('click_preview')}</span>
            )}
          </span>
        </span>
      </button>
      {/* `download`: a PDF / video key is served inline, and this control means "save", not "open". */}
      <a
        href={downloadHref}
        download
        aria-label={t('download_file_aria', { name })}
        title={tz('attach_download')}
        className="mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <Download className="h-4 w-4" aria-hidden />
      </a>
    </div>
  );
}
