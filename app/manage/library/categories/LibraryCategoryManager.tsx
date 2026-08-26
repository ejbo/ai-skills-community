'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Star, StarOff, Trash2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

interface Row {
  id: string;
  slug: string;
  name: string;
  nameEn: string;
  official: boolean;
  sortOrder: number;
  createdBy: string | null;
  docCount: number;
}

const input =
  'h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-900 dark:focus:border-zinc-100 dark:border-zinc-800 dark:bg-zinc-900';

export function LibraryCategoryManager({ categories }: { categories: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', nameEn: '' });

  async function call(init: RequestInit & { url?: string }, okMsg: string) {
    const { url, ...rest } = init;
    const res = await fetch(url ?? '/api/manage/library-categories', rest);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      pushToast('error', data?.reason ?? '操作失败');
      return null;
    }
    pushToast('success', okMsg);
    router.refresh();
    return data;
  }

  return (
    <div className="space-y-4">
      <section className="surface flex flex-wrap items-end gap-3 rounded-2xl p-5">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted">中文名</label>
          <input
            className={input}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="如：推理部署"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted">English</label>
          <input
            className={input}
            value={draft.nameEn}
            onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })}
            placeholder="Inference & serving"
          />
        </div>
        <button
          type="button"
          disabled={busy === 'create' || draft.name.trim().length < 2}
          onClick={async () => {
            setBusy('create');
            await call(
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: draft.name.trim(), nameEn: draft.nameEn.trim() }),
              },
              '官方分类已保存',
            );
            setDraft({ name: '', nameEn: '' });
            setBusy(null);
          }}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 text-sm font-medium text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-60"
        >
          {busy === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          新建官方分类
        </button>
      </section>

      <section className="surface rounded-2xl">
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-5 py-3">
              <span className="text-sm font-medium">{c.name}</span>
              {c.nameEn && <span className="text-xs text-muted">{c.nameEn}</span>}
              <span className="font-mono text-xs text-muted">{c.slug}</span>
              {c.official ? (
                <span className="rounded bg-zinc-900/[0.06] dark:bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-zinc-900 dark:text-zinc-50">
                  官方
                </span>
              ) : (
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-muted dark:bg-zinc-800">
                  成员创建{c.createdBy ? ` · ${c.createdBy}` : ''}
                </span>
              )}
              <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted">
                {c.docCount} 篇
              </span>
              <button
                type="button"
                disabled={busy === c.id}
                onClick={async () => {
                  setBusy(c.id);
                  await call(
                    {
                      method: 'PATCH',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ id: c.id, official: !c.official }),
                    },
                    c.official ? '已降为成员分类' : '已设为官方分类',
                  );
                  setBusy(null);
                }}
                title={c.official ? '取消官方' : '设为官方'}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-zinc-200 text-muted transition hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700"
              >
                {c.official ? <StarOff className="h-3.5 w-3.5" /> : <Star className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                disabled={busy === c.id}
                onClick={async () => {
                  if (
                    !window.confirm(
                      c.docCount > 0
                        ? `删除分类「${c.name}」？${c.docCount} 篇文档仍带着这个标记，只是不再出现在选择器里。`
                        : `删除分类「${c.name}」？`,
                    )
                  )
                    return;
                  setBusy(c.id);
                  await call(
                    { url: `/api/manage/library-categories?id=${c.id}`, method: 'DELETE' },
                    '分类已删除',
                  );
                  setBusy(null);
                }}
                aria-label="删除"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-zinc-200 text-muted transition hover:border-danger/50 hover:text-danger dark:border-zinc-700"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
