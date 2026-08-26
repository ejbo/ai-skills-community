'use client';

// One attachment tile: icon by extension (or the image thumbnail), name,
// size, preview state badge. Click → the preview drawer (`file` kind) when the
// attachment has an id (saved rows); composer drafts without an id open the
// raw file in a new tab instead.

import type { MouseEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  File,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Presentation,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react';
import { withBasePath } from '@/lib/base-path';
import { formatBytes, isOfficePreviewable } from '@/lib/zones/shared';
import type { ZoneAttachmentView } from '@/lib/zones/types';
import { usePreview } from '@/components/zones/preview/PreviewProvider';

export function attachmentIconFor(a: { kind: ZoneAttachmentView['kind']; ext: string }): LucideIcon {
  if (a.kind === 'image') return ImageIcon;
  if (a.kind === 'video') return Video;
  switch (a.ext.toLowerCase()) {
    case 'pdf':
    case 'doc':
    case 'docx':
    case 'txt':
    case 'md':
      return FileText;
    case 'ppt':
    case 'pptx':
      return Presentation;
    case 'xls':
    case 'xlsx':
    case 'csv':
      return FileSpreadsheet;
    case 'zip':
      return FileArchive;
    case 'json':
      return FileCode;
    default:
      return File;
  }
}

/** `zones` key describing the preview state, or null when nothing to say. */
export function attachmentPreviewBadgeKey(a: ZoneAttachmentView): string | null {
  if (a.kind === 'image' || a.kind === 'video' || a.ext === 'pdf') return 'attach_previewable';
  if (isOfficePreviewable(a.ext)) {
    if (a.previewStatus === 'ready') return 'attach_previewable';
    if (a.previewStatus === 'pending') return 'attach_preview_pending';
    if (a.previewStatus === 'failed') return 'attach_preview_failed';
    if (a.previewStatus === 'unsupported') return null;
    return null;
  }
  return null;
}

export function AttachmentCard({
  attachment,
  onRemove,
  onOpen,
  compact = false,
}: {
  attachment: ZoneAttachmentView;
  onRemove?: () => void;
  /** Override the default open behaviour (drawer / new tab). */
  onOpen?: () => void;
  compact?: boolean;
}) {
  const t = useTranslations('zones');
  const preview = usePreview();
  const Icon = attachmentIconFor(attachment);
  const badgeKey = attachmentPreviewBadgeKey(attachment);
  const url = withBasePath(attachment.url);

  const open = () => {
    if (onOpen) return onOpen();
    if (attachment.id) preview.open({ kind: 'file', ref: attachment.id, title: attachment.name });
    else window.open(url, '_blank', 'noopener');
  };

  return (
    <div
      className={`group relative flex items-center gap-3 rounded-xl border border-zinc-200 bg-white text-left transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600 ${
        compact ? 'p-2' : 'p-2.5'
      }`}
    >
      <button type="button" onClick={open} className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 rounded-lg">
        {attachment.kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" loading="lazy" className={`shrink-0 rounded-md bg-zinc-100 object-cover dark:bg-zinc-900 ${compact ? 'h-9 w-9' : 'h-12 w-12'}`} />
        ) : attachment.kind === 'video' && attachment.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={withBasePath(attachment.posterUrl)} alt="" loading="lazy" className={`shrink-0 rounded-md bg-black object-cover ${compact ? 'h-9 w-9' : 'h-12 w-12'}`} />
        ) : (
          <span className={`flex shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300 ${compact ? 'h-9 w-9' : 'h-12 w-12'}`}>
            <Icon className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-medium ${compact ? 'text-xs' : 'text-sm'}`}>{attachment.name || attachment.ext.toUpperCase()}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] tabular-nums text-muted">
            <span>{(attachment.ext || attachment.mimeType || attachment.kind).toUpperCase()}</span>
            <span>{formatBytes(attachment.sizeBytes)}</span>
            {attachment.width && attachment.height && (
              <span>
                {attachment.width}×{attachment.height}
              </span>
            )}
            {badgeKey && (
              <span className="rounded-full border border-zinc-300 px-1.5 py-px font-sans text-[10px] dark:border-zinc-700">{t(badgeKey)}</span>
            )}
          </span>
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={(e: MouseEvent) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={t('attach_remove')}
          title={t('attach_remove')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
