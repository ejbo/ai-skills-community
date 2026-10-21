'use client';

// /manage/library 的「封面图片库」：上传一批图（png / jpg / webp / gif，≤ 5 MB），没有封面的文档按 id 稳定地随机配一张；
// 「给没有封面的文档配图」一键补齐已有文档。规则在 lib/library/cover-pool.ts。后台按设计保持中文。

import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2, Wand2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import type { CoverPoolImage } from '@/lib/library/cover-pool';

const BTN = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium transition hover:border-zinc-900 disabled:opacity-50 dark:border-zinc-800 dark:hover:border-zinc-100';
const BTN_INK = 'inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white';

export function CoverPoolCard() {
  const [images, setImages] = useState<CoverPoolImage[] | null>(null);
  const [busy, setBusy] = useState<'upload' | 'backfill' | string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch('/api/admin/library/cover-pool');
      const data = (await res.json().catch(() => ({}))) as { images?: CoverPoolImage[] };
      if (!cancelled) setImages(data.images ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy('upload');
    try {
      const form = new FormData();
      for (const f of Array.from(files).slice(0, 40)) form.append('files', f);
      const res = await fetch('/api/admin/library/cover-pool', { method: 'POST', body: form });
      const data = (await res.json().catch(() => ({}))) as { added?: CoverPoolImage[]; rejected?: { name: string; reason: string }[] };
      if (!res.ok) return pushToast('error', '上传失败');
      setImages((prev) => [...(data.added ?? []), ...(prev ?? [])]);
      const rejected = data.rejected ?? [];
      pushToast(rejected.length ? 'error' : 'success', `已加入 ${data.added?.length ?? 0} 张${rejected.length ? `，跳过 ${rejected.length} 张（${rejected.map((r) => `${r.name}：${r.reason === 'too_large' ? '超过 5 MB' : '不是图片'}`).join('；')}）` : ''}`);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async (img: CoverPoolImage) => {
    if (!window.confirm(`从图片库移除「${img.name || img.key}」？已配给文档的封面不受影响。`)) return;
    setBusy(img.id);
    try {
      const res = await fetch(`/api/admin/library/cover-pool/${img.id}`, { method: 'DELETE' });
      if (!res.ok) return pushToast('error', '移除失败');
      setImages((prev) => (prev ?? []).filter((x) => x.id !== img.id));
    } finally {
      setBusy(null);
    }
  };

  const backfill = async () => {
    setBusy('backfill');
    try {
      const res = await fetch('/api/admin/library/cover-pool/backfill', { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { assigned?: number };
      if (!res.ok) return pushToast('error', '配图失败');
      pushToast('success', `已给 ${data.assigned ?? 0} 篇没有封面的文档配图`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="surface rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">封面图片库</h3>
          <p className="mt-1 max-w-2xl text-xs text-muted">
            抓不到封面或封面难看的文档，按文档 id 从这里稳定地随机配一张（同一篇每次都是同一张）。新收录的文档自动配；
            已有文档用右边的按钮补齐。重新处理抓到真封面时会覆盖配的图。png / jpg / webp / gif，单张 ≤ 5 MB，一次最多 40 张。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
          <button type="button" className={BTN_INK} disabled={!!busy} onClick={() => fileRef.current?.click()}>
            {busy === 'upload' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            上传图片
          </button>
          <button type="button" className={BTN} disabled={!!busy || !images?.length} onClick={backfill}>
            {busy === 'backfill' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            给没有封面的文档配图
          </button>
        </div>
      </div>
      {images === null ? (
        <p className="mt-4 text-xs text-muted">加载中…</p>
      ) : images.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-center text-xs text-muted dark:border-zinc-700">图片库是空的——先上传几张。没有图时文档照旧用默认占位封面。</p>
      ) : (
        <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          {images.map((img) => (
            <li key={img.id} className="group relative aspect-[3/4] overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={withBasePath(img.url)} alt={img.name} loading="lazy" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => remove(img)}
                disabled={busy === img.id}
                aria-label="移除"
                className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-zinc-700 opacity-0 shadow transition group-hover:opacity-100 focus-visible:opacity-100 dark:bg-zinc-900/90 dark:text-zinc-200"
              >
                {busy === img.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {images && images.length > 0 && <p className="mt-2 text-[11px] text-muted">共 {images.length} 张</p>}
    </section>
  );
}
