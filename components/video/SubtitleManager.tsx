'use client';

// 后台编辑页的「字幕」卡片 — everything a manager can do to a long video's
// subtitles, against /api/videos/[slug]/subtitles:
//   · 自动生成 / 重新生成 — the local whisper + LLM pipeline (queued; this card polls
//     while it runs). A box with no whisper answers 503 and says so.
//   · 上传 VTT / SRT per language — for a box without whisper, or to replace a
//     mis-heard ASR track with a corrected one. 「并翻译另一语言」 asks the house LLM
//     for the other track from the uploaded cues.
//   · 下载 — the stored VTT, to fix in an editor and upload back.
//   · 移除.
// The AI summary/chat read the transcript derived from these tracks, which is why
// the card says so: fixing a name in the subtitles fixes it in the summary too.
//
// /manage is Chinese by design, but VideoForm already reads the `video` namespace
// for every label — this card follows it rather than hardcoding.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Captions, Download, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import { SUBTITLE_FILE_MAX_BYTES, type SubtitleLang } from '@/lib/video/subtitles-shared';

export interface SubtitleState {
  status: 'none' | 'processing' | 'ready' | 'failed';
  srcLang: string | null;
  zhUrl: string | null;
  enUrl: string | null;
  error: string | null;
}

const POLL_MS = 8000;

export function SubtitleManager({ slug, initial, hasSource }: { slug: string; initial: SubtitleState; hasSource: boolean }) {
  const t = useTranslations('video');
  const router = useRouter();
  const [state, setState] = useState<SubtitleState>(initial);
  const [busy, setBusy] = useState<null | 'generate' | SubtitleLang>(null);
  const [translate, setTranslate] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadLang = useRef<SubtitleLang>('zh');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/videos/${slug}/subtitles`, { cache: 'no-store' });
      if (!res.ok) return;
      const d = (await res.json()) as { status: SubtitleState['status']; srcLang: string | null; zhUrl: string | null; enUrl: string | null; error: string | null };
      setState({ status: d.status, srcLang: d.srcLang, zhUrl: d.zhUrl, enUrl: d.enUrl, error: d.error });
    } catch {
      /* next tick */
    }
  }, [slug]);

  // Poll while a job runs (and once more shortly after an upload asked for a translation).
  useEffect(() => {
    if (state.status !== 'processing') return;
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [state.status, refresh]);

  async function generate() {
    setBusy('generate');
    try {
      const res = await fetch(`/api/videos/${slug}/subtitles`, { method: 'POST' });
      const d = (await res.json().catch(() => null)) as { error?: string; reason?: string } | null;
      if (!res.ok) {
        pushToast('error', d?.error === 'subtitles_unconfigured' ? t('manage.sub_err_unconfigured') : d?.error === 'rate_limited' ? t('manage.sub_err_rate') : t('manage.sub_err_failed'));
        return;
      }
      setState((s) => ({ ...s, status: 'processing', error: null }));
      pushToast('success', t('manage.sub_queued'));
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File, lang: SubtitleLang) {
    if (file.size > SUBTITLE_FILE_MAX_BYTES) {
      pushToast('error', t('manage.sub_err_too_large'));
      return;
    }
    setBusy(lang);
    try {
      const other = lang === 'zh' ? state.enUrl : state.zhUrl;
      const wantTranslate = translate && !other;
      const res = await fetch(`/api/videos/${slug}/subtitles?lang=${lang}${wantTranslate ? '&translate=1' : ''}`, {
        method: 'PUT',
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: await file.arrayBuffer(),
      });
      const d = (await res.json().catch(() => null)) as { error?: string; cues?: number } | null;
      if (!res.ok) {
        pushToast(
          'error',
          d?.error === 'invalid_subtitle_file' ? t('manage.sub_err_invalid') : d?.error === 'subtitles_busy' ? t('manage.sub_err_busy') : d?.error === 'file_too_large' ? t('manage.sub_err_too_large') : t('manage.sub_err_failed'),
        );
        return;
      }
      pushToast('success', t('manage.sub_uploaded', { count: d?.cues ?? 0 }));
      await refresh();
      // The translated twin arrives a little later; look again so the row fills in without a reload.
      if (wantTranslate) setTimeout(() => void refresh(), 20_000);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove(lang: SubtitleLang) {
    if (!window.confirm(t('manage.sub_remove_confirm'))) return;
    setBusy(lang);
    try {
      const res = await fetch(`/api/videos/${slug}/subtitles?lang=${lang}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        pushToast('error', d?.error === 'subtitles_busy' ? t('manage.sub_err_busy') : t('manage.sub_err_failed'));
        return;
      }
      await refresh();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const processing = state.status === 'processing';
  const statusText =
    state.status === 'processing'
      ? t('manage.sub_status_processing')
      : state.status === 'ready'
        ? t('manage.sub_status_ready')
        : state.status === 'failed'
          ? t('manage.sub_status_failed')
          : t('manage.sub_status_none');

  const small =
    'inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 px-2 text-[11px] font-medium transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900';

  const rows: { lang: SubtitleLang; label: string; url: string | null }[] = [
    { lang: 'zh', label: t('player.sub_zh'), url: state.zhUrl },
    { lang: 'en', label: t('player.sub_en'), url: state.enUrl },
  ];

  return (
    <section className="surface space-y-3 rounded-xl p-4">
      <div className="flex items-center gap-2">
        <Captions className="h-4 w-4 text-muted" aria-hidden />
        <h3 className="flex-1 text-sm font-semibold">{t('manage.sub_title')}</h3>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            state.status === 'failed' ? 'bg-danger/10 text-danger' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
          }`}
        >
          {processing && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          {statusText}
        </span>
      </div>

      <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {rows.map((row) => (
          <li key={row.lang} className="flex flex-wrap items-center gap-1.5 px-2.5 py-2">
            <span className="min-w-[3.5rem] flex-1 text-xs font-medium">
              {row.label}
              {state.srcLang === row.lang && row.url && <span className="ml-1.5 text-[10px] font-normal text-muted">{t('manage.sub_source_lang')}</span>}
              {!row.url && <span className="ml-1.5 text-[10px] font-normal text-muted">{t('manage.sub_track_none')}</span>}
            </span>
            {row.url && (
              <a href={withBasePath(row.url)} download={`${slug}.${row.lang}.vtt`} className={small}>
                <Download className="h-3 w-3" aria-hidden />
                {t('manage.sub_download')}
              </a>
            )}
            <button
              type="button"
              className={small}
              disabled={busy !== null || processing}
              onClick={() => {
                uploadLang.current = row.lang;
                fileInput.current?.click();
              }}
            >
              {busy === row.lang ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Upload className="h-3 w-3" aria-hidden />}
              {row.url ? t('manage.sub_replace') : t('manage.sub_upload')}
            </button>
            {row.url && (
              <button type="button" className={`${small} text-danger hover:bg-danger/10`} disabled={busy !== null || processing} onClick={() => void remove(row.lang)} aria-label={t('manage.sub_remove')} title={t('manage.sub_remove')}>
                <Trash2 className="h-3 w-3" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>

      <label className="flex items-start gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={translate}
          onChange={(e) => setTranslate(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 accent-zinc-900 dark:accent-zinc-100"
        />
        {t('manage.sub_translate_other')}
      </label>

      <button
        type="button"
        onClick={() => void generate()}
        disabled={busy !== null || processing || !hasSource}
        className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 text-sm font-medium transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:hover:bg-zinc-900"
      >
        {busy === 'generate' || processing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
        {state.zhUrl || state.enUrl ? t('manage.sub_regenerate') : t('manage.sub_generate')}
      </button>

      {state.error && <p className="rounded-lg bg-zinc-100 px-2.5 py-2 text-[11px] leading-relaxed text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{state.error}</p>}
      <p className="text-[11px] leading-relaxed text-muted">{t('manage.sub_hint')}</p>

      <input
        ref={fileInput}
        type="file"
        accept=".vtt,.srt,text/vtt,application/x-subrip,text/plain"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file, uploadLang.current);
        }}
      />
    </section>
  );
}
