'use client';

// Post attachment LEDGER (composer): every file the post carries, whether it
// was dropped into the 正文 (the editor appends it here through
// `embedPicker.upload.onUploaded`) or added with the buttons below. Uploads
// go through the raw-body protocol (upload-core.ts) sequentially with
// per-file XHR progress; the only limits are the per-file byte caps and the
// route's 30/min burst limiter — on a 429 the queue sleeps `retry-after` and
// retries the same file (≤ 3×). COUNTS ARE UNLIMITED by product decision;
// do not reintroduce n/N counters or disabled add buttons.
//
// Copies MediaPicker's invariants: the draft is read from a ref (two parallel
// uploads must not clobber each other), the in-flight count is reported
// OUTSIDE setState and zeroed on unmount.

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useTranslations } from 'next-intl';
import { FileUp, ImagePlus, Loader2, Video } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { LiveList } from '@/components/motion';
import { ZONE_FILE_ACCEPT, ZONE_IMAGE_TYPES, ZONE_VIDEO_TYPES, formatBytes } from '@/lib/zones/shared';
import type { ZoneAttachmentView } from '@/lib/zones/types';
import { AttachmentCard, attachmentPreviewRef } from './AttachmentCard';
import {
  MAX_BYTES,
  MAX_RATE_LIMIT_RETRIES,
  UploadError,
  classify,
  clampAttachmentName,
  draftFromUpload,
  draftToView,
  retryWaitMs,
  uploadEndpoint,
  uploadErrorKey,
  uploadRaw,
  type AttachmentDraft,
  type UploadKind,
} from './upload-core';

// Re-exports so every existing import from this module keeps compiling (SPEC §1.10).
export {
  ATTACHMENT_NAME_MAX,
  UploadError,
  attachmentPayload,
  clampAttachmentName,
  classify,
  draftFromView,
  draftToView,
  uploadEndpoint,
  uploadErrorKey,
  uploadRaw,
  zoneMediaKeyFromPublicUrl,
} from './upload-core';
export type { AttachmentDraft, RawUploadResult, UploadKind } from './upload-core';

const IMAGE_ACCEPT = Array.from(ZONE_IMAGE_TYPES).join(',');
const VIDEO_ACCEPT = Array.from(ZONE_VIDEO_TYPES).join(',');

interface Progress {
  id: number;
  name: string;
  kind: UploadKind;
  pct: number;
  queued: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function AttachmentUploader({
  zoneSlug,
  value,
  onChange,
  onUploadingChange,
  disabled = false,
  insertedRefs,
  onInsert,
  onRemove,
  compact = true,
}: {
  zoneSlug: string;
  value: AttachmentDraft[];
  onChange: (next: AttachmentDraft[]) => void;
  /** Reports the number of in-flight uploads so the parent can gate submit. */
  onUploadingChange?: (count: number) => void;
  disabled?: boolean;
  /** Ids / storage keys that appear as `[embed:file:…]` in the body → 「正文中」 chip instead of 在正文插入. */
  insertedRefs?: ReadonlySet<string>;
  /** 「在正文插入」 — the host inserts the card at the caret block. */
  onInsert?: (draft: AttachmentDraft) => void;
  /** Fired AFTER the row left the list so the host can strip its body token. */
  onRemove?: (index: number, draft: AttachmentDraft) => void;
  compact?: boolean;
}) {
  const t = useTranslations('zones');
  const [progress, setProgress] = useState<Progress[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const draftRef = useRef(value);
  draftRef.current = value;
  const uploadingRef = useRef(0);
  const onUploadingChangeRef = useRef(onUploadingChange);
  onUploadingChangeRef.current = onUploadingChange;
  const nextId = useRef(1);

  function bump(delta: number) {
    uploadingRef.current = Math.max(0, uploadingRef.current + delta);
    onUploadingChangeRef.current?.(uploadingRef.current);
  }
  useEffect(() => () => onUploadingChangeRef.current?.(0), []);

  function commit(mutate: (d: AttachmentDraft[]) => AttachmentDraft[]) {
    const next = mutate(draftRef.current);
    draftRef.current = next;
    onChange(next);
  }

  async function uploadOne(file: File, kind: UploadKind) {
    const name = clampAttachmentName(file.name);
    if (file.size > MAX_BYTES[kind]) {
      pushToast('error', t('attach_too_large', { name, max: formatBytes(MAX_BYTES[kind]) }));
      return;
    }
    const id = nextId.current++;
    setProgress((p) => [...p, { id, name, kind, pct: 0, queued: false }]);
    bump(1);
    const setRow = (patch: Partial<Progress>) => setProgress((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    try {
      let attempts = 0;
      for (;;) {
        attempts += 1;
        try {
          const r = await uploadRaw(file, uploadEndpoint(zoneSlug), { 'x-upload-kind': kind }, (pct) => setRow({ pct, queued: false }));
          commit((d) => [...d, draftFromUpload(file, kind, r, name)]);
          return;
        } catch (e) {
          // Same policy as the editor's queue: a 429 parks the file, then retries it.
          if (e instanceof UploadError && e.code === 'rate_limited' && attempts <= MAX_RATE_LIMIT_RETRIES) {
            setRow({ queued: true });
            await sleep(retryWaitMs(e));
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      pushToast('error', t('attach_upload_error', { name, error: t(uploadErrorKey(e)) }));
    } finally {
      bump(-1);
      setProgress((p) => p.filter((x) => x.id !== id));
    }
  }

  async function addFiles(list: FileList | File[] | null, forcedKind?: UploadKind) {
    if (!list || disabled) return;
    const files = Array.from(list);
    for (const file of files) {
      const kind = forcedKind ?? classify(file);
      if (!kind) {
        pushToast('error', t('attach_upload_error', { name: clampAttachmentName(file.name), error: t('attach_err_unsupported_type') }));
        continue;
      }
      // Sequential: the server's burst limiter and the disk both prefer it, and
      // progress rows stay readable.
      // eslint-disable-next-line no-await-in-loop
      await uploadOne(file, kind);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    void addFiles(e.dataTransfer?.files ?? null);
  }

  function remove(index: number) {
    const gone = draftRef.current[index];
    commit((d) => d.filter((_, i) => i !== index));
    if (gone) onRemove?.(index, gone);
  }

  const busy = progress.length > 0;
  const isInserted = (d: AttachmentDraft) => Boolean(insertedRefs && ((d.id && insertedRefs.has(d.id)) || insertedRefs.has(d.key)));

  const btn =
    'inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-50';
  const ghost =
    'inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100';
  const chip =
    'inline-flex h-7 shrink-0 items-center rounded-full border border-zinc-300 px-2 text-[11px] font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400';

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`rounded-xl border border-dashed p-3 transition ${
        dragOver ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900' : 'border-zinc-300 dark:border-zinc-700'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} disabled={disabled} onClick={() => imageInput.current?.click()}>
          <ImagePlus className="h-3.5 w-3.5" />
          {t('attach_add_image')}
        </button>
        <button type="button" className={btn} disabled={disabled} onClick={() => videoInput.current?.click()}>
          <Video className="h-3.5 w-3.5" />
          {t('attach_add_video')}
        </button>
        <button type="button" className={btn} disabled={disabled} onClick={() => fileInput.current?.click()}>
          <FileUp className="h-3.5 w-3.5" />
          {t('attach_add_file')}
        </button>
        <span className="ml-auto text-[11px] text-muted">{t('attach_drop_hint')}</span>
      </div>

      <input ref={imageInput} type="file" accept={IMAGE_ACCEPT} multiple hidden onChange={(e) => { void addFiles(e.target.files, 'image'); e.target.value = ''; }} />
      <input ref={videoInput} type="file" accept={VIDEO_ACCEPT} multiple hidden onChange={(e) => { void addFiles(e.target.files, 'video'); e.target.value = ''; }} />
      <input ref={fileInput} type="file" accept={ZONE_FILE_ACCEPT} multiple hidden onChange={(e) => { void addFiles(e.target.files, 'file'); e.target.value = ''; }} />

      {busy && (
        <ul className="mt-3 space-y-1.5">
          {progress.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-xs">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted" />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.queued ? (
                <span className="shrink-0 text-[11px] text-muted">{t('attach_upload_queued')}</span>
              ) : (
                <>
                  <span className="h-1 w-24 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <span className="block h-full bg-zinc-900 transition-[width] dark:bg-zinc-100" style={{ width: `${Math.round(p.pct)}%` }} />
                  </span>
                  <span className="w-9 text-right font-mono tabular-nums text-muted">{Math.round(p.pct)}%</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {value.length > 0 && (
        <LiveList
          className={`mt-3 ${compact ? 'space-y-1.5' : 'grid gap-2 sm:grid-cols-2'}`}
          items={value}
          keyOf={(d) => d.key}
          render={(d, index) => {
            const view: ZoneAttachmentView = draftToView(d);
            const inBody = isInserted(d);
            return (
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <AttachmentCard attachment={view} compact={compact} onRemove={disabled ? undefined : () => remove(index)} />
                </div>
                {inBody ? (
                  <span className={chip}>{t('composer_attach_in_body')}</span>
                ) : onInsert ? (
                  <button type="button" className={ghost} disabled={disabled || !attachmentPreviewRef(view)} onClick={() => onInsert(d)}>
                    {t('composer_attach_insert')}
                  </button>
                ) : null}
              </div>
            );
          }}
        />
      )}
      <p className="mt-2 text-[11px] text-muted">
        {t('attach_size_hint', {
          imageMax: formatBytes(MAX_BYTES.image),
          videoMax: formatBytes(MAX_BYTES.video),
          fileMax: formatBytes(MAX_BYTES.file),
        })}
      </p>
    </div>
  );
}
