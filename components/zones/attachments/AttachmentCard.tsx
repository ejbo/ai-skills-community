'use client';

// One attachment tile: icon by extension (or the image thumbnail), name,
// size, preview state badge. Click → the preview panel (`file` kind) by row id
// when saved, else by STORAGE KEY. `active` marks the row that is open in the
// docked panel (aria-current + ink border).
//
// A key-form ref only RESOLVES once the post is saved: `/api/zones/embed`
// answers a `file` key through `ZonePostAttachment`, and a composer draft has
// no row — the panel used to open on 内容不存在或已删除 while the row itself
// advertised 可预览. So a caller that owns unsaved drafts passes `zoneSlug` and
// the card hands the panel the data it already has (the same synthesis
// EmbedNodeView does for an in-body card).

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
import type { EmbedData, ZoneAttachmentView } from '@/lib/zones/types';
import { usePreview } from '@/components/zones/preview/PreviewProvider';
import { zoneMediaKeyFromPublicUrl } from './upload-core';

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

/** The preview ref of an attachment: the row id, else its storage key. */
export function attachmentPreviewRef(a: ZoneAttachmentView): string | null {
  return a.id || zoneMediaKeyFromPublicUrl(a.url);
}

export function AttachmentCard({
  attachment,
  onRemove,
  onOpen,
  compact = false,
  active = false,
  zoneSlug,
}: {
  attachment: ZoneAttachmentView;
  onRemove?: () => void;
  /** Override the default open behaviour. `via` is 'keyboard' for an Enter/Space click (event.detail === 0). */
  onOpen?: (via: 'pointer' | 'keyboard') => void;
  compact?: boolean;
  /** The row that is open in the preview panel — aria-current + ink border. */
  active?: boolean;
  /** Composer ledger: the zone an UNSAVED row (no id) belongs to, so its preview is synthesized locally. */
  zoneSlug?: string;
}) {
  const t = useTranslations('zones');
  const preview = usePreview();
  const Icon = attachmentIconFor(attachment);
  const badgeKey = attachmentPreviewBadgeKey(attachment);
  const url = withBasePath(attachment.url);

  const open = (e: MouseEvent<HTMLButtonElement>) => {
    const via: 'pointer' | 'keyboard' = e.detail === 0 ? 'keyboard' : 'pointer';
    if (onOpen) return onOpen(via);
    const ref = attachmentPreviewRef(attachment);
    if (!ref) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    // No row id ⇒ the ref is a storage key the embed API cannot resolve yet.
    const local: EmbedData | undefined =
      attachment.id || zoneSlug === undefined
        ? undefined
        : { kind: 'file', ref, ok: true, data: { ...attachment, postId: '', zoneSlug } };
    preview.open({ kind: 'file', ref, title: attachment.name, via, data: local });
  };

  return (
    <div
      aria-current={active ? 'true' : undefined}
      className={`group relative flex items-center gap-3 rounded-xl border bg-white text-left transition dark:bg-zinc-950 ${
        active
          ? 'border-zinc-900 dark:border-zinc-100'
          : 'border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600'
      } ${compact ? 'p-2' : 'p-2.5'}`}
    >
      <button type="button" onClick={open} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-zinc-400">
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
