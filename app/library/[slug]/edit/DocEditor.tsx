'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'framer-motion';
import { FileUp, ImagePlus, Loader2, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import { DocCover } from '@/components/library/DocCover';
import { ChapterHtmlEditor, type ChapterEditorMode } from '@/components/library/ChapterHtmlEditor';
import { DOC_TYPES, LIBRARY_CATEGORIES } from '@/lib/library/types';

interface EditableDoc {
  id: string;
  slug: string;
  title: string;
  author: string | null;
  summary: string;
  summaryEn: string;
  abstractMd: string;
  abstractMdEn: string;
  docType: string;
  categories: string[];
  visibility: string;
  format: string;
  sourceUrl: string | null;
  status: string;
  coverUrl: string | null;
  chapters: { chapterIndex: number; title: string | null; charCount: number }[];
}

// 可见性选项值 — label 走 labels.visibility.*，hint 走 library.visibility_*_hint
const VISIBILITY_OPTIONS = ['public', 'restricted', 'private'] as const;

const inputCls =
  'h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-accent-500 dark:border-zinc-800 dark:bg-zinc-900';
const labelCls = 'mb-1.5 block text-xs font-medium text-muted';

export function DocEditor({ doc }: { doc: EditableDoc }) {
  const t = useTranslations('library');
  const tl = useTranslations('labels');
  const tc = useTranslations('common');
  const ts = useTranslations('settings');
  const router = useRouter();
  const [title, setTitle] = useState(doc.title);
  const [author, setAuthor] = useState(doc.author ?? '');
  const [summary, setSummary] = useState(doc.summary);
  const [summaryEn, setSummaryEn] = useState(doc.summaryEn);
  const [abstractMd, setAbstractMd] = useState(doc.abstractMd);
  const [abstractMdEn, setAbstractMdEn] = useState(doc.abstractMdEn);
  // 中文 / English are stored side by side (lib/library/i18n-content.ts) — the
  // viewer's 设置 → 语言 picks one, with 中文 as the fallback.
  const [contentLang, setContentLang] = useState<'zh' | 'en'>('zh');
  const [docType, setDocType] = useState(doc.docType);
  const [categories, setCategories] = useState<string[]>(doc.categories);
  const [visibility, setVisibility] = useState(doc.visibility);
  const [coverUrl, setCoverUrl] = useState(doc.coverUrl);
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [editingChapter, setEditingChapter] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);

  function toggleCategory(slug: string) {
    setCategories((prev) =>
      prev.includes(slug)
        ? prev.filter((c) => c !== slug)
        : prev.length >= 4
          ? (pushToast('info', t('max_categories')), prev)
          : [...prev, slug],
    );
  }

  async function saveMeta() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const res = await fetch(`/api/library/docs/${doc.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          author: author.trim(),
          summary: summary.trim(),
          summaryEn: summaryEn.trim(),
          abstractMd: abstractMd.trim(),
          abstractMdEn: abstractMdEn.trim(),
          docType,
          categories,
          visibility,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data?.reason ?? t('save_failed_retry'));
        return;
      }
      pushToast('success', tc('saved'));
      router.refresh();
    } catch {
      pushToast('error', t('network_error_retry'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function reprocess() {
    if (busyAction) return;
    if (!window.confirm(t('reprocess_confirm'))) return;
    setBusyAction('reprocess');
    try {
      const res = await fetch(`/api/library/docs/${doc.id}/reprocess`, { method: 'POST' });
      if (!res.ok) throw new Error('failed');
      pushToast('success', t('reprocess_started'));
      router.push(`/library/${doc.slug}`);
    } catch {
      pushToast('error', t('action_failed_retry'));
    } finally {
      setBusyAction(null);
    }
  }

  function replaceFile(file: File) {
    if (busyAction) return;
    const lower = file.name.toLowerCase();
    if (!/\.(pdf|epub|html?|pptx|docx)$/.test(lower)) {
      pushToast('error', t('file_type_unsupported'));
      return;
    }
    setBusyAction('replace');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', withBasePath(`/api/library/docs/${doc.id}/replace`));
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
    xhr.onerror = () => {
      setBusyAction(null);
      pushToast('error', t('network_error_retry'));
    };
    xhr.onload = () => {
      setBusyAction(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        pushToast('success', t('file_replaced'));
        router.push(`/library/${doc.slug}`);
      } else {
        pushToast('error', t('replace_failed'));
      }
    };
    xhr.send(file);
  }

  async function removeDoc() {
    if (busyAction) return;
    if (!window.confirm(t('delete_doc_confirm'))) return;
    setBusyAction('delete');
    try {
      const res = await fetch(`/api/library/docs/${doc.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('failed');
      pushToast('success', t('deleted_done'));
      router.push('/library');
    } catch {
      pushToast('error', t('delete_failed_retry'));
      setBusyAction(null);
    }
  }

  function uploadCover(file: File) {
    if (busyAction) return;
    if (!file.type.startsWith('image/')) {
      pushToast('error', ts('pick_image'));
      return;
    }
    setBusyAction('cover');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', withBasePath(`/api/library/docs/${doc.id}/cover`));
    xhr.setRequestHeader('content-type', file.type);
    xhr.onerror = () => {
      setBusyAction(null);
      pushToast('error', t('network_error_retry'));
    };
    xhr.onload = () => {
      setBusyAction(null);
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data.coverUrl) {
          setCoverUrl(data.coverUrl);
          pushToast('success', t('cover_updated'));
          router.refresh();
          return;
        }
        pushToast('error', data?.reason ?? t('cover_upload_failed'));
      } catch {
        pushToast('error', t('cover_upload_failed'));
      }
    };
    xhr.send(file);
  }

  async function removeCover() {
    if (busyAction) return;
    setBusyAction('cover');
    try {
      const res = await fetch(`/api/library/docs/${doc.id}/cover`, { method: 'DELETE' });
      if (!res.ok) throw new Error('failed');
      setCoverUrl(null);
      pushToast('success', t('cover_reset_done'));
      router.refresh();
    } catch {
      pushToast('error', t('action_failed_retry'));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="mt-6 space-y-6">
      <section className="surface rounded-2xl p-5">
        <h2 className="text-base font-semibold">{t('publish_info')}</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2 flex items-start gap-4">
            <DocCover
              key={coverUrl ?? 'placeholder'}
              title={title || doc.title}
              coverUrl={coverUrl}
              docType={docType}
              className="h-32 w-24 shrink-0 rounded-xl text-2xl"
            />
            <div className="space-y-2 pt-1">
              <label className={labelCls}>{t('cover_label')}</label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => coverInputRef.current?.click()}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium transition hover:border-accent-500 hover:text-accent-600 disabled:opacity-60 dark:border-zinc-700"
                >
                  {busyAction === 'cover' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImagePlus className="h-3.5 w-3.5" />
                  )}
                  {t('upload_cover')}
                </button>
                {coverUrl && (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void removeCover()}
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium text-muted transition hover:border-danger/50 hover:text-danger disabled:opacity-60 dark:border-zinc-700"
                  >
                    {t('reset_cover')}
                  </button>
                )}
              </div>
              <p className="text-xs text-muted">{t('cover_hint')}</p>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadCover(file);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>{t('title_label')}</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{t('author_label')}</label>
            <input value={author} onChange={(e) => setAuthor(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{t('type_label')}</label>
            <select value={docType} onChange={(e) => setDocType(e.target.value)} className={inputCls}>
              {DOC_TYPES.map((dt) => (
                <option key={dt} value={dt}>
                  {tl(`docType.${dt}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-medium text-muted">{t('content_language')}</span>
              <div className="inline-flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
                {(['zh', 'en'] as const).map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    aria-pressed={contentLang === lang}
                    onClick={() => setContentLang(lang)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                      contentLang === lang
                        ? 'bg-accent-500 text-white'
                        : 'text-muted hover:text-accent-600'
                    }`}
                  >
                    {lang === 'zh' ? t('lang_zh') : t('lang_en')}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted">{t('content_language_hint')}</span>
            </div>
            <label className={labelCls}>{t('summary_label')}</label>
            <textarea
              key={`summary-${contentLang}`}
              value={contentLang === 'zh' ? summary : summaryEn}
              onChange={(e) =>
                contentLang === 'zh' ? setSummary(e.target.value) : setSummaryEn(e.target.value)
              }
              rows={2}
              maxLength={1000}
              placeholder={contentLang === 'en' ? t('summary_en_placeholder') : undefined}
              className="w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent-500 dark:border-zinc-800 dark:bg-zinc-900"
            />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>{t('abstract_label')}</label>
            <textarea
              key={`abstract-${contentLang}`}
              value={contentLang === 'zh' ? abstractMd : abstractMdEn}
              onChange={(e) =>
                contentLang === 'zh' ? setAbstractMd(e.target.value) : setAbstractMdEn(e.target.value)
              }
              rows={5}
              maxLength={20000}
              placeholder={
                contentLang === 'en' ? t('abstract_en_placeholder') : t('abstract_placeholder')
              }
              className="w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent-500 dark:border-zinc-800 dark:bg-zinc-900"
            />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>{t('categories_label')}</label>
            <div className="flex flex-wrap gap-1.5">
              {LIBRARY_CATEGORIES.map((c) => {
                const on = categories.includes(c.slug);
                return (
                  <button
                    key={c.slug}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleCategory(c.slug)}
                    className={`rounded-full px-2.5 py-1 text-xs transition ${
                      on
                        ? 'bg-accent-500 font-medium text-white'
                        : 'border border-zinc-200 text-muted hover:border-accent-400 hover:text-accent-600 dark:border-zinc-700'
                    }`}
                  >
                    {tl(`libCategory.${c.slug}`)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>{t('visibility_label')}</label>
            <div className="grid gap-2 sm:grid-cols-3">
              {VISIBILITY_OPTIONS.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={visibility === v}
                  onClick={() => setVisibility(v)}
                  className={`rounded-xl border p-3 text-left transition ${
                    visibility === v
                      ? 'border-accent-500 bg-accent-500/5'
                      : 'border-zinc-200 hover:border-accent-400 dark:border-zinc-700'
                  }`}
                >
                  <span className="block text-sm font-medium">{tl(`visibility.${v}`)}</span>
                  <span className="mt-0.5 block text-xs text-muted">{t(`visibility_${v}_hint`)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={saving || !title.trim()}
            onClick={() => void saveMeta()}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('save_info')}
          </button>
        </div>
      </section>

      {doc.status === 'ready' && doc.chapters.length > 0 && (
        <section className="surface rounded-2xl p-5">
          <h2 className="text-base font-semibold">{t('reading_content')}</h2>
          <p className="mt-1 text-xs text-muted">{t('chapters_edit_hint')}</p>
          {doc.format === 'pdf' && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              {t('chapter_pdf_edit_hint')}
            </p>
          )}
          <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {doc.chapters.map((ch) => (
              <li key={ch.chapterIndex} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="w-7 shrink-0 font-mono text-xs tabular-nums text-muted">
                  {ch.chapterIndex + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {ch.title ?? t('chapter_n', { num: ch.chapterIndex + 1 })}
                </span>
                <button
                  type="button"
                  onClick={() => setEditingChapter(ch.chapterIndex)}
                  className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-zinc-200 px-2 text-xs transition hover:border-accent-500 hover:text-accent-600 dark:border-zinc-700"
                >
                  <Pencil className="h-3 w-3" />
                  {tc('edit')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="surface rounded-2xl p-5">
        <h2 className="text-base font-semibold">{t('source_section')}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {doc.format === 'url' ? (
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => void reprocess()}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-4 text-sm font-medium transition hover:border-accent-500 hover:text-accent-600 disabled:opacity-60 dark:border-zinc-700"
            >
              {busyAction === 'reprocess' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {t('refetch_source')}
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => fileInputRef.current?.click()}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-4 text-sm font-medium transition hover:border-accent-500 hover:text-accent-600 disabled:opacity-60 dark:border-zinc-700"
              >
                {busyAction === 'replace' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileUp className="h-4 w-4" />
                )}
                {t('replace_file')}
              </button>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => void reprocess()}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-4 text-sm font-medium transition hover:border-accent-500 hover:text-accent-600 disabled:opacity-60 dark:border-zinc-700"
              >
                {busyAction === 'reprocess' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {t('reprocess')}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.epub,.html,.htm,.pptx,.docx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) replaceFile(file);
                  e.target.value = '';
                }}
              />
            </>
          )}
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void removeDoc()}
            className="ml-auto flex h-9 items-center gap-1.5 rounded-lg border border-danger/40 px-4 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" />
            {t('delete_doc')}
          </button>
        </div>
        {doc.sourceUrl && (
          <p className="mt-2 truncate text-xs text-muted">{t('source_prefix', { url: doc.sourceUrl })}</p>
        )}
      </section>

      <AnimatePresence>
        {editingChapter !== null && (
          <ChapterEditModal
            // Remount per chapter: the WYSIWYG surface is uncontrolled after
            // its first seed, so a prop-only chapter swap would keep showing
            // the previous chapter's content.
            key={editingChapter}
            docId={doc.id}
            chapterIndex={editingChapter}
            onClose={() => setEditingChapter(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ChapterEditModal({
  docId,
  chapterIndex,
  onClose,
}: {
  docId: string;
  chapterIndex: number;
  onClose: () => void;
}) {
  const t = useTranslations('library');
  const tc = useTranslations('common');
  const [title, setTitle] = useState('');
  const [html, setHtml] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 排版 (the processed reading format) is the default — the uploader edits what
  // readers see, not tag soup. 源码 stays as the escape hatch.
  const [editorMode, setEditorMode] = useState<ChapterEditorMode>('rich');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/library/docs/${docId}/chapters/${chapterIndex}`);
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.ok && data?.chapter) {
          setTitle(data.chapter.title ?? '');
          setHtml(data.chapter.html ?? '');
        } else {
          pushToast('error', t('chapter_load_failed'));
          onClose();
        }
      } catch {
        if (!cancelled) {
          pushToast('error', t('network_error'));
          onClose();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, chapterIndex]);

  async function save() {
    if (saving || html === null) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/library/docs/${docId}/chapters/${chapterIndex}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ html, title: title.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data?.reason ?? t('save_failed_retry'));
        return;
      }
      pushToast('success', t('chapter_saved'));
      onClose();
    } catch {
      pushToast('error', t('network_error_retry'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => !saving && onClose()}
      />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        className="surface relative z-10 flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">{t('edit_chapter_n', { num: chapterIndex + 1 })}</h3>
          <button
            type="button"
            onClick={() => !saving && onClose()}
            aria-label={tc('dismiss')}
            className="grid h-7 w-7 place-items-center rounded-lg text-muted transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {html === null ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-accent-500" />
          </div>
        ) : (
          <>
            <div className="mt-3">
              <label className={labelCls}>{t('chapter_title_label')}</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
            </div>
            <div className="mt-3 flex min-h-0 flex-1 flex-col">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <label className="text-xs font-medium text-muted">{t('chapter_content_label')}</label>
                <div className="inline-flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
                  {(['rich', 'source'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={editorMode === m}
                      onClick={() => setEditorMode(m)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                        editorMode === m
                          ? 'bg-accent-500 text-white'
                          : 'text-muted hover:text-accent-600'
                      }`}
                    >
                      {m === 'rich' ? t('chapter_mode_rich') : t('chapter_mode_source')}
                    </button>
                  ))}
                </div>
              </div>
              <ChapterHtmlEditor value={html} onChange={setHtml} mode={editorMode} />
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => onClose()}
                className="h-9 rounded-lg border border-zinc-200 px-4 text-sm font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {tc('cancel')}
              </button>
              <button
                type="button"
                disabled={saving || !html.trim()}
                onClick={() => void save()}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('save_chapter')}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
