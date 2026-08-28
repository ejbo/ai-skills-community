'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'framer-motion';
import { FileUp, Link2, Loader2, Plus, UploadCloud, X } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { CategoryPicker } from '@/components/library/CategoryPicker';
import { withBasePath } from '@/lib/base-path';
import { currentLoginHref } from '@/lib/auth/callback-path';
import {
  DOC_TYPES,
  type LibraryDocTypeValue,
} from '@/lib/library/types';

type DocTypeChoice = 'auto' | LibraryDocTypeValue;
type Translator = ReturnType<typeof useTranslations>;

// API error code → library_ui toast key（错误码本身不翻译，仅映射展示文案）。
const ERROR_TOAST_KEYS: Record<string, string> = {
  invalid_url: 'err_invalid_url',
  fetch_failed: 'err_fetch_failed',
  unsupported_content: 'err_unsupported_content',
  unsupported_type: 'err_unsupported_type',
  file_too_large: 'err_file_too_large',
  too_large: 'err_file_too_large',
  rate_limited: 'err_rate_limited',
};

function toastForError(
  status: number,
  data: { error?: string; reason?: string },
  t: Translator,
  tv: Translator,
) {
  if (data.reason) return data.reason;
  if (data.error === 'unauthenticated') return tv('login_required');
  if (data.error && ERROR_TOAST_KEYS[data.error]) return t(ERROR_TOAST_KEYS[data.error]);
  if (status === 415) return t('err_unsupported_type');
  if (status === 413) return t('err_file_too_large');
  if (status === 502) return t('err_fetch_failed');
  if (status === 429) return t('err_rate_limited');
  if (status === 401) return tv('login_required');
  return t('action_failed');
}

/** 「+ 添加内容」按钮 + 两 tab（链接 / 文件）提交弹窗。 */
export function AddDocButton({ loggedIn }: { loggedIn: boolean }) {
  const t = useTranslations('library_ui');
  const tl = useTranslations('labels');
  const tv = useTranslations('video');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'url' | 'file'>('url');
  const [url, setUrl] = useState('');
  const [docType, setDocType] = useState<DocTypeChoice>('auto');
  const [categories, setCategories] = useState<string[]>([]);
  const [stage, setStage] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<string | null>(null);
  stageRef.current = stage;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !stageRef.current) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  function openModal() {
    if (!loggedIn) {
      pushToast('error', t('login_before_add'));
      router.push(currentLoginHref());
      return;
    }
    setOpen(true);
  }

  function goToLogin() {
    pushToast('error', tv('login_required'));
    router.push(currentLoginHref());
  }

  function done(doc: { slug: string }, existing: boolean) {
    if (existing) pushToast('info', t('already_in_library'));
    setOpen(false);
    setUrl('');
    router.push(`/library/${doc.slug}`);
  }

  async function submitUrl() {
    const trimmed = url.trim();
    if (!trimmed) {
      pushToast('error', t('enter_url'));
      return;
    }
    if (stage) return;
    setStage(t('stage_fetching'));
    try {
      const res = await fetch('/api/library/docs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: trimmed,
          ...(docType === 'auto' ? {} : { docType }),
          ...(categories.length > 0 ? { categories } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        goToLogin();
        return;
      }
      if (!res.ok || !data.doc) {
        pushToast('error', toastForError(res.status, data, t, tv));
        return;
      }
      done(data.doc, Boolean(data.existing));
    } catch {
      pushToast('error', t('network_error'));
    } finally {
      setStage(null);
    }
  }

  function uploadFile(file: File) {
    if (stage) return;
    const lower = file.name.toLowerCase();
    if (!/\.(pdf|epub|html?|pptx|docx)$/.test(lower)) {
      pushToast('error', t('err_unsupported_type'));
      return;
    }
    setStage(t('stage_uploading'));
    // XHR（非 fetch）以拿到上传进度；fetch shim 不覆盖 XHR，需手动 withBasePath。
    const xhr = new XMLHttpRequest();
    xhr.open('POST', withBasePath('/api/library/upload'));
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
    if (docType !== 'auto') xhr.setRequestHeader('x-doc-type', docType);
    if (categories.length > 0) xhr.setRequestHeader('x-categories', JSON.stringify(categories));
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable || e.total <= 0) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      setStage(pct >= 100 ? t('stage_parsing') : t('stage_uploading_pct', { pct }));
    };
    xhr.onerror = () => {
      setStage(null);
      pushToast('error', t('network_error'));
    };
    xhr.onload = () => {
      setStage(null);
      let data: {
        doc?: { slug: string };
        existing?: boolean;
        error?: string;
        reason?: string;
      } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* 非 JSON 响应走通用错误 */
      }
      if (xhr.status === 401) {
        goToLogin();
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300 || !data.doc) {
        pushToast('error', toastForError(xhr.status, data, t, tv));
        return;
      }
      done(data.doc, Boolean(data.existing));
    };
    xhr.send(file);
  }

  const tabCls = (active: boolean) =>
    `relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition ${
      active ? 'text-zinc-900 dark:text-white' : 'text-muted hover:text-zinc-700 dark:hover:text-zinc-200'
    }`;

  const typeSelect = (
    <div className="space-y-3">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted">{t('type_label')}</label>
        <select
          value={docType}
          onChange={(e) => setDocType(e.target.value as DocTypeChoice)}
          disabled={Boolean(stage)}
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
        <label className="mb-1.5 block text-xs font-medium text-muted">
          {t('category_label')}
        </label>
        <CategoryPicker selected={categories} onChange={setCategories} disabled={Boolean(stage)} />
      </div>
    </div>
  );

  return (
    <>
      <button
        onClick={openModal}
        className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 text-sm font-medium text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-300"
      >
        <Plus className="h-4 w-4" />
        {t('add_content')}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="add-doc-modal"
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => !stage && setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className="surface relative z-10 w-full max-w-lg rounded-2xl p-5 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold tracking-tight">{t('add_content')}</h2>
                <button
                  onClick={() => !stage && setOpen(false)}
                  aria-label={tc('dismiss')}
                  className="grid h-7 w-7 place-items-center rounded-lg text-muted transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 flex border-b border-zinc-200 dark:border-zinc-800">
                <button onClick={() => !stage && setTab('url')} className={tabCls(tab === 'url')}>
                  <Link2 className="h-4 w-4" />
                  {t('tab_url')}
                  {tab === 'url' && (
                    <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-zinc-900 dark:bg-zinc-100" />
                  )}
                </button>
                <button onClick={() => !stage && setTab('file')} className={tabCls(tab === 'file')}>
                  <FileUp className="h-4 w-4" />
                  {t('tab_file')}
                  {tab === 'file' && (
                    <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-zinc-900 dark:bg-zinc-100" />
                  )}
                </button>
              </div>

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
                      disabled={Boolean(stage)}
                      className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                    />
                  </div>
                  {typeSelect}
                  <p className="text-xs text-muted">
                    {t('url_hint')}
                  </p>
                  <div className="flex items-center justify-end gap-3">
                    {stage && (
                      <span className="flex items-center gap-1.5 text-xs text-muted">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {stage}
                      </span>
                    )}
                    <button
                      onClick={submitUrl}
                      disabled={Boolean(stage)}
                      className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 text-sm font-medium text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-60"
                    >
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
                      if (file) uploadFile(file);
                    }}
                    onClick={() => !stage && fileInputRef.current?.click()}
                    className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
                      dragOver
                        ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900/[0.06] dark:bg-white/10'
                        : 'border-zinc-200 hover:border-zinc-400 dark:border-zinc-700'
                    }`}
                  >
                    {stage ? (
                      <>
                        <Loader2 className="h-6 w-6 animate-spin text-zinc-900 dark:text-zinc-50" />
                        <p className="text-sm font-medium">{stage}</p>
                      </>
                    ) : (
                      <>
                        <UploadCloud className="h-6 w-6 text-muted" />
                        <p className="text-sm font-medium">{t('drop_hint')}</p>
                        <p className="text-xs text-muted">{t('file_types_hint')}</p>
                      </>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.epub,.html,.htm,.pptx,.docx"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadFile(file);
                      e.target.value = '';
                    }}
                  />
                  {typeSelect}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
