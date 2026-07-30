'use client';

import { useRef, useState } from 'react';
import { Loader2, FileText, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import {
  type StagedFile,
  stageRaw,
  extractDataTransfer,
  mergeStaged,
  hasSkillMd,
} from './staged';

/**
 * GitHub-style upload area + staged file list, in one bordered block. Controlled:
 * the parent owns `staged`. Used by the create form (builds v1) and the
 * new-version uploader.
 */
export function FileDropZone({
  staged,
  onChange,
  title,
  hint,
}: {
  staged: StagedFile[];
  onChange: (next: StagedFile[]) => void;
  title?: string;
  hint?: string;
}) {
  const t = useTranslations('skills_misc');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const totalBytes = staged.reduce((n, f) => n + f.size, 0);
  const skillMdPresent = hasSkillMd(staged);

  async function ingest(entries: { file: File; path: string }[]) {
    if (entries.length === 0) return;
    setBusy(true);
    try {
      const next = await stageRaw(entries);
      onChange(mergeStaged(staged, next));
    } catch (e) {
      pushToast(
        'error',
        t('dropzone_unzip_failed', {
          message: e instanceof Error ? e.message : t('error_unknown'),
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  function pick(list: FileList | null, useRelPath: boolean) {
    if (!list || list.length === 0) return;
    void ingest(
      Array.from(list).map((file) => ({
        file,
        path: (useRelPath && file.webkitRelativePath) || file.name,
      })),
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3.5 py-2.5 text-sm font-semibold dark:border-zinc-800">
        <span>{title ?? t('dropzone_title')}</span>
        <span className="text-xs font-normal text-muted">
          {staged.length > 0
            ? t('dropzone_staged_summary', {
                count: staged.length,
                size: (totalBytes / 1024).toFixed(1),
              })
            : (hint ?? t('dropzone_hint'))}
        </span>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void extractDataTransfer(e.dataTransfer).then(ingest);
        }}
        className={`m-3.5 flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition ${
          dragging ? 'border-accent-500 bg-accent-500/5' : 'border-zinc-300 dark:border-zinc-700'
        }`}
      >
        <p className="text-sm text-muted">
          {busy ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('processing')}
            </span>
          ) : (
            <>
              {t('dropzone_drag_here')}{' '}
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="font-semibold text-accent-600 hover:text-accent-700 dark:text-accent-400"
              >
                {t('dropzone_pick_files')}
              </button>{' '}
              /{' '}
              <button
                type="button"
                onClick={() => folderInput.current?.click()}
                className="font-semibold text-accent-600 hover:text-accent-700 dark:text-accent-400"
              >
                {t('dropzone_pick_folder')}
              </button>
            </>
          )}
        </p>
        <p className="mt-1 text-[11px] text-muted">{t('dropzone_hint2')}</p>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            pick(e.target.files, false);
            e.target.value = '';
          }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          className="hidden"
          // @ts-expect-error -- webkitdirectory is non-standard but widely supported
          webkitdirectory=""
          onChange={(e) => {
            pick(e.target.files, true);
            e.target.value = '';
          }}
        />
      </div>

      {staged.length > 0 && !skillMdPresent && (
        <div className="mx-3.5 mb-3 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
          {t('dropzone_missing_skill_md')}
        </div>
      )}

      {staged.map((f) => (
        <div
          key={f.path}
          className="group flex items-center justify-between gap-2 border-t border-zinc-100 px-3.5 py-2 text-sm dark:border-zinc-800/60"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted" />
            <span className="truncate font-mono text-xs">{f.path}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="font-mono text-[10px] text-muted">{(f.size / 1024).toFixed(1)} KB</span>
            <button
              type="button"
              onClick={() => onChange(staged.filter((x) => x.path !== f.path))}
              className="text-muted opacity-0 transition group-hover:opacity-100 hover:text-danger"
              aria-label={t('remove_item', { name: f.path })}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
