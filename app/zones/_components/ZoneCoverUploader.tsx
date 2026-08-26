'use client';

// 技术专区 — cover / icon uploader for the settings form. House raw-body XHR
// protocol to POST /api/zones/[slug]/upload with `x-upload-kind` (XHR is not
// covered by the fetch shim → withBasePath). The parent stores the echoed key
// and sends it with PATCH; the preview swaps immediately.

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { HairlineGrid } from '@/components/motion';
import { withBasePath } from '@/lib/base-path';
import { MAX_ZONE_COVER_BYTES, ZONE_IMAGE_TYPES, formatBytes } from '@/lib/zones/shared';
import { BTN_SECONDARY } from './ui';

export type ZoneImageKind = 'cover' | 'icon';

export interface UploadedZoneMedia {
  key: string;
  url: string;
  size: number;
}

/** Raw-body upload; rejects with the server error code. */
export function uploadZoneMedia(
  zoneSlug: string,
  file: File,
  kind: ZoneImageKind,
  onProgress?: (pct: number) => void,
): Promise<UploadedZoneMedia> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', withBasePath(`/api/zones/${zoneSlug}/upload`));
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-upload-kind', kind);
    xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadedZoneMedia);
        } catch {
          reject(new Error('bad_response'));
        }
      } else {
        let msg = 'upload_failed';
        try {
          msg = (JSON.parse(xhr.responseText) as { error?: string }).error || msg;
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

export function ZoneCoverUploader({
  zoneSlug,
  kind,
  url,
  onChange,
  disabled = false,
}: {
  zoneSlug: string;
  kind: ZoneImageKind;
  /** Current (root-relative) URL — stored value or the freshly uploaded one. */
  url: string | null;
  onChange: (next: { key: string | null; url: string | null }) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('zones');
  const inputRef = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);

  async function pick(file: File) {
    if (!ZONE_IMAGE_TYPES.has(file.type)) {
      pushToast('error', t('upload_unsupported_type'));
      return;
    }
    if (file.size > MAX_ZONE_COVER_BYTES) {
      pushToast('error', t('upload_too_large', { max: formatBytes(MAX_ZONE_COVER_BYTES) }));
      return;
    }
    setPct(0);
    try {
      const up = await uploadZoneMedia(zoneSlug, file, kind, setPct);
      onChange({ key: up.key, url: up.url });
      pushToast('success', t('upload_done'));
    } catch (e) {
      const code = e instanceof Error ? e.message : 'upload_failed';
      pushToast(
        'error',
        code === 'file_too_large'
          ? t('upload_too_large', { max: formatBytes(MAX_ZONE_COVER_BYTES) })
          : code === 'unsupported_type'
            ? t('upload_unsupported_type')
            : t('upload_failed'),
      );
    } finally {
      setPct(null);
    }
  }

  const isCover = kind === 'cover';
  const frame = isCover ? 'aspect-[3/1] w-full' : 'h-24 w-24';

  return (
    <div className="flex flex-col gap-2">
      <div
        className={`${frame} relative overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900`}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- stored root-relative media URL
          <img src={withBasePath(url)} alt="" className="h-full w-full object-cover" />
        ) : (
          <>
            <HairlineGrid size={isCover ? 32 : 12} mask="center" />
            <div className="absolute inset-0 flex items-center justify-center text-zinc-400">
              <ImagePlus className={isCover ? 'h-6 w-6' : 'h-5 w-5'} />
            </div>
          </>
        )}
        {pct != null && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/70 backdrop-blur-sm dark:bg-zinc-950/70">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
            <div className="h-1 w-24 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div className="h-full bg-zinc-900 transition-[width] dark:bg-zinc-50" style={{ width: `${Math.round(pct)}%` }} />
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={Array.from(ZONE_IMAGE_TYPES).join(',')}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void pick(f);
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || pct != null}
          className={`${BTN_SECONDARY} h-8 px-3 text-xs`}
        >
          <ImagePlus className="h-3.5 w-3.5" />
          {url ? t('upload_replace') : isCover ? t('upload_cover') : t('upload_icon')}
        </button>
        {url && (
          <button
            type="button"
            onClick={() => onChange({ key: null, url: null })}
            disabled={disabled || pct != null}
            className={`${BTN_SECONDARY} h-8 px-3 text-xs`}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('upload_remove')}
          </button>
        )}
        <span className="text-[11px] text-muted">
          {isCover ? t('upload_cover_hint', { max: formatBytes(MAX_ZONE_COVER_BYTES) }) : t('upload_icon_hint')}
        </span>
      </div>
    </div>
  );
}
