'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2, Users } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { TAG_COLORS, tagColorClass } from '@/lib/user-tags';

interface ManagedTag {
  id: string;
  key: string;
  name: string;
  description: string;
  color: string;
  kind: 'manual' | 'auto';
  sortOrder: number;
  assignedCount: number;
}

const input = 'h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-900 dark:focus:border-zinc-100 dark:border-zinc-800 dark:bg-zinc-900';

export function UserTagsManager({ tags }: { tags: ManagedTag[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ key: '', name: '', description: '', color: 'zinc' });
  const [assignFor, setAssignFor] = useState<ManagedTag | null>(null);

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/manage/user-tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data?.reason ?? '创建失败');
        return;
      }
      pushToast('success', '标签已创建');
      setDraft({ key: '', name: '', description: '', color: 'zinc' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(tag: ManagedTag) {
    if (busy) return;
    if (!window.confirm(`删除标签「${tag.name}」？已指派给 ${tag.assignedCount} 人的记录会一并移除。`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/manage/user-tags?id=${tag.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data?.reason ?? '删除失败');
        return;
      }
      pushToast('success', '标签已删除');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="surface rounded-2xl p-5">
        <h3 className="text-base font-semibold">新建标签</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <input
            className={input}
            placeholder="key（小写英文，如 expert）"
            value={draft.key}
            onChange={(e) => setDraft({ ...draft, key: e.target.value })}
          />
          <input
            className={input}
            placeholder="显示名（如 专家）"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            className={`${input} md:col-span-1`}
            placeholder="说明（可选）"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
          <div className="flex items-center gap-2">
            <select
              className={input}
              value={draft.color}
              onChange={(e) => setDraft({ ...draft, color: e.target.value })}
            >
              {TAG_COLORS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !draft.key.trim() || !draft.name.trim()}
              onClick={() => void create()}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3 text-sm font-medium text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              创建
            </button>
          </div>
        </div>
      </section>

      <section className="surface rounded-2xl">
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {tags.map((tag) => (
            <li key={tag.id} className="flex items-center gap-3 px-5 py-3">
              <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${tagColorClass(tag.color)}`}>
                {tag.name}
              </span>
              <span className="font-mono text-xs text-muted">{tag.key}</span>
              {tag.kind === 'auto' && (
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-muted dark:bg-zinc-800">
                  系统
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-xs text-muted">{tag.description}</span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                {tag.assignedCount} 人
              </span>
              {tag.kind === 'manual' && (
                <>
                  <button
                    type="button"
                    onClick={() => setAssignFor(tag)}
                    className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-zinc-200 px-2.5 text-xs transition hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700"
                  >
                    <Users className="h-3.5 w-3.5" />
                    指派
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(tag)}
                    aria-label="删除"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-zinc-200 text-muted transition hover:border-danger/50 hover:text-danger dark:border-zinc-700"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </li>
          ))}
          {tags.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted">还没有标签。</li>}
        </ul>
      </section>

      {assignFor && <AssignDialog tag={assignFor} onClose={() => setAssignFor(null)} />}
    </div>
  );
}

function AssignDialog({ tag, onClose }: { tag: ManagedTag; onClose: () => void }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(action: 'grant' | 'revoke') {
    // Accept newline / comma / space separated 工号 — the same paste shape the
    // employee importer takes.
    const handles = text.split(/[\s,，;；]+/).map((h) => h.trim()).filter(Boolean);
    if (handles.length === 0 || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/manage/user-tags/assign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tagId: tag.id, handles, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data?.reason ?? '操作失败');
        return;
      }
      pushToast(
        data.missing?.length ? 'info' : 'success',
        `${action === 'grant' ? '已指派' : '已移除'} ${data.matched} 人` +
          (data.missing?.length ? `，${data.missing.length} 个工号未匹配到账号` : ''),
      );
      router.refresh();
      if (!data.missing?.length) onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={() => !busy && onClose()} />
      <div className="surface relative z-10 w-full max-w-lg rounded-2xl p-5 shadow-2xl">
        <h3 className="text-base font-semibold">
          指派标签「{tag.name}」
        </h3>
        <p className="mt-1 text-xs text-muted">
          粘贴工号（handle），换行、逗号或空格分隔均可。已有的不会重复指派。
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={'z0001\nz0002\nz0003'}
          className="mt-3 w-full resize-y rounded-lg border border-zinc-200 bg-white p-3 font-mono text-xs outline-none focus:border-zinc-900 dark:focus:border-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-zinc-200 px-4 text-sm dark:border-zinc-700"
          >
            关闭
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run('revoke')}
            className="h-9 rounded-lg border border-zinc-200 px-4 text-sm transition hover:border-danger/50 hover:text-danger disabled:opacity-60 dark:border-zinc-700"
          >
            批量移除
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run('grant')}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 text-sm font-medium text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            批量指派
          </button>
        </div>
      </div>
    </div>
  );
}
