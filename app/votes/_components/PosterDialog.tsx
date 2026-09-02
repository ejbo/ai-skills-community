'use client';

// 发起人的封面编辑对话框（作品表 → 封面按钮）：更换封面图（立即上传生效）+
// 版式/取景框裁切（保存时 PATCH）。图片作品直接裁图片本身。

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import type { VoteEntryEditRow } from '@/lib/vote-queries';
import type { VotePosterAspect } from '@/lib/votes/shared';
import { PosterCropEditor } from './PosterCropEditor';
import { uploadVoteMedia } from './vote-upload';

export function PosterDialog({
  activityId,
  entry,
  onClose,
  onSaved,
}: {
  activityId: string;
  entry: VoteEntryEditRow;
  onClose: () => void;
  /** Merges the patched fields back into the editor's entries state. */
  onSaved: (patch: Partial<VoteEntryEditRow>) => void;
}) {
  const t = useTranslations('votes');
  const [posterUrl, setPosterUrl] = useState(entry.posterUrl);
  // ?? 防御：老缓存/旧载荷可能缺字段 — undefined 会让取景框算出 NaN 几何。
  const [aspect, setAspect] = useState<VotePosterAspect>(entry.posterAspect ?? 'landscape');
  const [pos, setPos] = useState(entry.posterPos ?? '');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const imageUrl = entry.kind === 'video' ? posterUrl : entry.fileUrl;

  async function replacePoster(file: File) {
    if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) {
      pushToast('error', t('sub_poster_invalid'));
      return;
    }
    setUploading(true);
    try {
      const res = await uploadVoteMedia(activityId, file, file.name, 'poster', {
        entryId: entry.id,
      });
      if (res.url) {
        setPosterUrl(res.url);
        onSaved({ posterUrl: res.url });
        pushToast('success', t('ed_saved'));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      const key =
        msg === 'vote_over'
          ? 'ed_vote_over'
          : msg === 'file_too_large'
            ? 'ed_file_too_large'
            : msg === 'unsupported_type'
              ? 'ed_unsupported_type'
              : msg === 'rate_limited'
                ? 'ed_rate_limited'
                : 'ed_upload_failed';
      pushToast('error', t(key));
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/votes/${activityId}/entries/${entry.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ posterAspect: aspect, posterPos: pos }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', t('ed_save_failed'));
        return;
      }
      onSaved({
        posterAspect: data.entry?.posterAspect ?? aspect,
        posterPos: data.entry?.posterPos ?? pos,
      });
      pushToast('success', t('ed_saved'));
      onClose();
    } catch {
      pushToast('error', t('ed_save_failed'));
    } finally {
      setSaving(false);
    }
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {t('ed_poster_title')}
            <span className="ml-2 text-sm font-normal text-muted">#{entry.entryNo}</span>
          </h2>
          <button
            type="button"
            aria-label={t('close')}
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4">
          {imageUrl ? (
            <PosterCropEditor
              imageUrl={imageUrl}
              kind={entry.kind}
              aspect={aspect}
              pos={pos}
              onAspectChange={setAspect}
              onPosChange={setPos}
            />
          ) : (
            <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-muted dark:border-zinc-700">
              {t('ed_poster_none')}
            </p>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          {entry.kind === 'video' ? (
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3.5 text-sm font-medium transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
              {t('ed_poster_replace')}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            disabled={saving || !imageUrl}
            onClick={() => void save()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('ed_poster_save')}
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void replacePoster(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>,
    document.body,
  );
}
