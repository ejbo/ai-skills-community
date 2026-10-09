'use client';

// 添加内容 dialog — the form (链接 / 文件 tabs, 类型, 主题) plus the live job list.
// Submitting hands the work to IngestJobsProvider and clears the form at once; the
// member can add another, 收起 to the bottom-right dock and keep browsing, or close
// (= 收起 while anything runs). Nothing here blocks on the server any more, and
// nothing navigates away on completion — 「查看」 on the job row is the member's call.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'framer-motion';
import { FileUp, Link2, Minus, Plus, UploadCloud, X } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { CategoryPicker } from '@/components/library/CategoryPicker';
import { currentLoginHref } from '@/lib/auth/callback-path';
import { DOC_TYPES, type LibraryDocTypeValue } from '@/lib/library/types';
import { isActiveJob } from '@/lib/library/ingest-shared';
import { useIngestJobs } from './IngestJobsProvider';
import { JobRow } from './JobRow';

type DocTypeChoice = 'auto' | LibraryDocTypeValue;

export function AddDocDialog() {
  const t = useTranslations('library_ui');
  const tl = useTranslations('labels');
  const tc = useTranslations('common');
  const { jobs, dialogOpen, closeDialog, minimize, startUrl, startFile, dismiss } = useIngestJobs();
  const [tab, setTab] = useState<'url' | 'file'>('url');
  const [url, setUrl] = useState('');
  const [docType, setDocType] = useState<DocTypeChoice>('auto');
  const [categories, setCategories] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const anyActive = jobs.some(isActiveJob);

  useEffect(() => {
    if (!dialogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDialog();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [dialogOpen, closeDialog]);

  function submitUrl() {
    const trimmed = url.trim();
    if (!trimmed) {
      pushToast('error', t('enter_url'));
      return;
    }
    startUrl(trimmed, { docType, categories });
    setUrl('');
  }

  function pickFile(file: File) {
    if (!/\.(pdf|epub|html?|pptx|docx)$/.test(file.name.toLowerCase())) {
      pushToast('error', t('err_unsupported_type'));
      return;
    }
    startFile(file, { docType, categories });
  }

  const tabCls = (on: boolean) =>
    `relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition ${
      on ? 'text-zinc-900 dark:text-white' : 'text-muted hover:text-zinc-700 dark:hover:text-zinc-200'
    }`;
  const iconBtn =
    'grid h-7 w-7 place-items-center rounded-lg text-muted transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100';

  const typeSelect = (
    <div className="space-y-3">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted">{t('type_label')}</label>
        <select
          value={docType}
          onChange={(e) => setDocType(e.target.value as DocTypeChoice)}
          className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <option value="auto">{t('auto_detect')}</option>
          {DOC_TYPES.map((dt) => (
            <option key={dt} value={dt}>
              {tl(`docType.${dt}`)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted">{t('category_label')}</label>
        <CategoryPicker selected={categories} onChange={setCategories} />
      </div>
    </div>
  );

  return (
    <AnimatePresence>
      {dialogOpen && (
        <motion.div key="add-doc-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={closeDialog}
          />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="surface relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col rounded-2xl p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold tracking-tight">{t('add_content')}</h2>
              <div className="flex items-center gap-1">
                <button type="button" onClick={minimize} aria-label={t('ingest_minimize')} title={t('ingest_minimize')} className={iconBtn}>
                  <Minus className="h-4 w-4" />
                </button>
                <button type="button" onClick={closeDialog} aria-label={tc('dismiss')} className={iconBtn}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-3 flex border-b border-zinc-200 dark:border-zinc-800">
              <button type="button" onClick={() => setTab('url')} className={tabCls(tab === 'url')}>
                <Link2 className="h-4 w-4" />
                {t('tab_url')}
                {tab === 'url' && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-zinc-900 dark:bg-zinc-100" />}
              </button>
              <button type="button" onClick={() => setTab('file')} className={tabCls(tab === 'file')}>
                <FileUp className="h-4 w-4" />
                {t('tab_file')}
                {tab === 'file' && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-zinc-900 dark:bg-zinc-100" />}
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
              {tab === 'url' ? (
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted">{t('url_label')}</label>
                    <input
                      autoFocus
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && submitUrl()}
                      placeholder="https://…"
                      className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                    />
                  </div>
                  {typeSelect}
                  <p className="text-xs text-muted">{t('url_hint')}</p>
                  <div className="flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={submitUrl}
                      className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                    >
                      <Plus className="h-4 w-4" />
                      {t('submit')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) pickFile(file);
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition ${
                      dragOver ? 'border-zinc-900 bg-zinc-900/[0.06] dark:border-zinc-100 dark:bg-white/10' : 'border-zinc-200 hover:border-zinc-400 dark:border-zinc-700'
                    }`}
                  >
                    <UploadCloud className="h-6 w-6 text-muted" />
                    <p className="text-sm font-medium">{t('drop_hint')}</p>
                    <p className="text-xs text-muted">{t('file_types_hint')}</p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.epub,.html,.htm,.pptx,.docx"
                    className="hidden"
                    data-testid="library-file-input"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) pickFile(file);
                      e.target.value = '';
                    }}
                  />
                  {typeSelect}
                </div>
              )}

              {jobs.length > 0 && (
                <section className="mt-5 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold tracking-wide text-muted">{t('ingest_jobs_title')}</h3>
                    {anyActive ? (
                      <button type="button" onClick={minimize} className="text-xs text-muted underline decoration-dotted underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-50">
                        {t('ingest_minimize')}
                      </button>
                    ) : null}
                  </div>
                  <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                    {jobs.map((job) => (
                      <JobRow key={job.id} job={job} onDismiss={dismiss} />
                    ))}
                  </div>
                  {anyActive && <p className="mt-2 text-[11px] text-muted">{t('ingest_background_hint')}</p>}
                </section>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
