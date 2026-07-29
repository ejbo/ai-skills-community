'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { FileUp, Link2, Loader2, Plus, UploadCloud, X } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import { DOC_TYPES, DOC_TYPE_LABELS, type LibraryDocTypeValue } from '@/lib/library/types';

type DocTypeChoice = 'auto' | LibraryDocTypeValue;

const ERROR_TOASTS: Record<string, string> = {
  invalid_url: '链接格式不正确',
  fetch_failed: '无法抓取该链接，请检查地址或稍后再试',
  unsupported_content: '暂不支持该内容类型',
  unsupported_type: '仅支持 PDF / EPUB 文件',
  file_too_large: '文件过大',
  too_large: '文件过大',
  rate_limited: '操作过于频繁，请稍后再试',
  unauthenticated: '请先登录',
};

function toastForError(status: number, data: { error?: string; reason?: string }) {
  if (data.reason) return data.reason;
  if (data.error && ERROR_TOASTS[data.error]) return ERROR_TOASTS[data.error];
  if (status === 415) return '仅支持 PDF / EPUB 文件';
  if (status === 413) return '文件过大';
  if (status === 502) return '无法抓取该链接，请检查地址或稍后再试';
  if (status === 429) return '操作过于频繁，请稍后再试';
  if (status === 401) return '请先登录';
  return '操作失败，请重试';
}

/** 「+ 添加内容」按钮 + 两 tab（链接 / 文件）提交弹窗。 */
export function AddDocButton({ loggedIn }: { loggedIn: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'url' | 'file'>('url');
  const [url, setUrl] = useState('');
  const [docType, setDocType] = useState<DocTypeChoice>('auto');
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
      pushToast('error', '请先登录再添加内容');
      router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
      return;
    }
    setOpen(true);
  }

  function goToLogin() {
    pushToast('error', '请先登录');
    router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
  }

  function done(doc: { slug: string }, existing: boolean) {
    if (existing) pushToast('info', '该内容已在知识库中');
    setOpen(false);
    setUrl('');
    router.push(`/library/${doc.slug}`);
  }

  async function submitUrl() {
    const trimmed = url.trim();
    if (!trimmed) {
      pushToast('error', '请输入链接');
      return;
    }
    if (stage) return;
    setStage('正在抓取网页并提取内容…');
    try {
      const res = await fetch('/api/library/docs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          docType === 'auto' ? { url: trimmed } : { url: trimmed, docType },
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        goToLogin();
        return;
      }
      if (!res.ok || !data.doc) {
        pushToast('error', toastForError(res.status, data));
        return;
      }
      done(data.doc, Boolean(data.existing));
    } catch {
      pushToast('error', '网络错误，请重试');
    } finally {
      setStage(null);
    }
  }

  function uploadFile(file: File) {
    if (stage) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.pdf') && !lower.endsWith('.epub')) {
      pushToast('error', '仅支持 PDF / EPUB 文件');
      return;
    }
    setStage('正在上传文件…');
    // XHR（非 fetch）以拿到上传进度；fetch shim 不覆盖 XHR，需手动 withBasePath。
    const xhr = new XMLHttpRequest();
    xhr.open('POST', withBasePath('/api/library/upload'));
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
    if (docType !== 'auto') xhr.setRequestHeader('x-doc-type', docType);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable || e.total <= 0) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      setStage(pct >= 100 ? '正在解析文档…' : `正在上传文件… ${pct}%`);
    };
    xhr.onerror = () => {
      setStage(null);
      pushToast('error', '网络错误，请重试');
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
        pushToast('error', toastForError(xhr.status, data));
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
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted">类型</label>
      <select
        value={docType}
        onChange={(e) => setDocType(e.target.value as DocTypeChoice)}
        disabled={Boolean(stage)}
        className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <option value="auto">自动识别</option>
        {DOC_TYPES.map((t) => (
          <option key={t} value={t}>
            {DOC_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <>
      <button
        onClick={openModal}
        className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600"
      >
        <Plus className="h-4 w-4" />
        添加内容
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
                <h2 className="text-base font-semibold tracking-tight">添加内容</h2>
                <button
                  onClick={() => !stage && setOpen(false)}
                  aria-label="关闭"
                  className="grid h-7 w-7 place-items-center rounded-lg text-muted transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 flex border-b border-zinc-200 dark:border-zinc-800">
                <button onClick={() => !stage && setTab('url')} className={tabCls(tab === 'url')}>
                  <Link2 className="h-4 w-4" />
                  链接
                  {tab === 'url' && (
                    <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent-500" />
                  )}
                </button>
                <button onClick={() => !stage && setTab('file')} className={tabCls(tab === 'file')}>
                  <FileUp className="h-4 w-4" />
                  文件
                  {tab === 'file' && (
                    <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent-500" />
                  )}
                </button>
              </div>

              {tab === 'url' ? (
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted">网页链接</label>
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
                    支持网页文章链接（博客、公众号、新闻等）；PDF 链接请下载后从「文件」上传。
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
                      className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
                    >
                      提交
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
                        ? 'border-accent-500 bg-accent-500/5'
                        : 'border-zinc-200 hover:border-accent-400 dark:border-zinc-700'
                    }`}
                  >
                    {stage ? (
                      <>
                        <Loader2 className="h-6 w-6 animate-spin text-accent-500" />
                        <p className="text-sm font-medium">{stage}</p>
                      </>
                    ) : (
                      <>
                        <UploadCloud className="h-6 w-6 text-muted" />
                        <p className="text-sm font-medium">拖拽文件到这里，或点击选择</p>
                        <p className="text-xs text-muted">支持 PDF（≤100MB）/ EPUB（≤50MB）</p>
                      </>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.epub"
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
