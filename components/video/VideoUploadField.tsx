'use client';

import { useRef, useState } from 'react';
import { UploadCloud, CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/video/types';

interface UploadResult {
  url: string;
  pathname: string;
  width?: number;
  height?: number;
  durationSec?: number;
}

/**
 * Reads intrinsic dimensions + duration from a video file by loading it into a
 * detached <video> element. Resolves with empty metadata if it can't be read.
 */
function probeVideoMetadata(
  file: File,
): Promise<{ width?: number; height?: number; durationSec?: number }> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const el = document.createElement('video');
    el.preload = 'metadata';
    const cleanup = () => URL.revokeObjectURL(objectUrl);
    el.onloadedmetadata = () => {
      const result = {
        width: el.videoWidth || undefined,
        height: el.videoHeight || undefined,
        durationSec: Number.isFinite(el.duration) ? Math.round(el.duration) : undefined,
      };
      cleanup();
      resolve(result);
    };
    el.onerror = () => {
      cleanup();
      resolve({});
    };
    el.src = objectUrl;
  });
}

/**
 * Direct self-hosted upload: POST the raw file to our own route, streamed to
 * disk server-side. XHR (not fetch) so we get upload progress.
 */
function uploadToServer(
  file: File,
  kind: 'source' | 'poster' | 'preview',
  onProgress: (pct: number) => void,
): Promise<{ key: string; url: string; size: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', withBasePath('/api/videos/upload'));
    xhr.setRequestHeader(
      'content-type',
      file.type || (kind === 'poster' ? 'image/jpeg' : 'video/mp4'),
    );
    xhr.setRequestHeader('x-upload-kind', kind);
    xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
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

export function VideoUploadField({
  kind,
  label,
  value,
  onUploaded,
}: {
  kind: 'source' | 'poster' | 'preview';
  label: string;
  value: { url: string; key?: string } | null;
  onUploaded: (r: UploadResult) => void;
}) {
  const t = useTranslations('video');
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setProgress(0);
    setFileName(file.name);
    try {
      const meta = kind === 'source' ? await probeVideoMetadata(file) : {};
      const res = await uploadToServer(file, kind, (p) => setProgress(p));
      onUploaded({
        url: res.url,
        pathname: res.key,
        width: meta.width,
        height: meta.height,
        durationSec: meta.durationSec,
      });
      pushToast('success', label);
    } catch (err) {
      console.error(err);
      pushToast('error', err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  const accept = kind === 'poster' ? 'image/*' : 'video/mp4,video/webm,video/quicktime';

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted">{label}</label>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />

      {value?.url && !uploading ? (
        <div className="surface flex items-center gap-3 rounded-lg p-2">
          {kind === 'poster' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={withBasePath(value.url)} alt="" className="h-12 w-20 rounded object-cover" />
          ) : (
            <video
              src={withBasePath(value.url)}
              className="h-12 w-20 rounded bg-black object-cover"
              muted
              playsInline
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-xs font-medium text-ok">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {fileName ?? 'Uploaded'}
            </div>
            <div className="truncate font-mono text-[10px] text-muted">{value.url}</div>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="h-7 rounded-lg border border-zinc-200 px-2 text-[11px] hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
          >
            {label}
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="surface flex w-full items-center gap-3 rounded-lg border-dashed p-3 text-left transition hover:border-zinc-400 disabled:opacity-70 dark:hover:border-zinc-500"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200">
            <UploadCloud className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            {uploading ? (
              <>
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate">{fileName ?? t('manage.uploading')}</span>
                  <span className="font-mono tabular-nums text-muted">{Math.round(progress)}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-zinc-800 transition-all dark:bg-zinc-200"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </>
            ) : (
              <span className="text-sm">{label}</span>
            )}
          </div>
        </button>
      )}
    </div>
  );
}
