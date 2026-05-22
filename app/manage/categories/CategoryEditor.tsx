'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Save, Trash2, Loader2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

interface Category {
  id: string;
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
  skillCount: number;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function CategoryEditor({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [list, setList] = useState(categories);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [pending, startTransition] = useTransition();

  function create() {
    if (!newName || !newSlug) {
      pushToast('error', '请填写名称和 slug');
      return;
    }
    startTransition(async () => {
      const res = await fetch('/api/admin/categories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newName, slug: newSlug, description: newDesc }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data.error ?? '创建失败');
        return;
      }
      pushToast('success', '已创建');
      setNewName('');
      setNewSlug('');
      setNewDesc('');
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="surface rounded-2xl p-4">
        <h3 className="mb-3 text-sm font-semibold">新建类别</h3>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_2fr_auto]">
          <input
            placeholder="名称"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              if (!newSlug) setNewSlug(slugify(e.target.value));
            }}
            className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          />
          <input
            placeholder="slug"
            value={newSlug}
            onChange={(e) => setNewSlug(slugify(e.target.value))}
            className="h-9 rounded-lg border border-zinc-200 bg-white px-3 font-mono text-xs dark:border-zinc-800 dark:bg-zinc-900"
          />
          <input
            placeholder="描述（可选）"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          />
          <button
            onClick={create}
            disabled={pending}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            创建
          </button>
        </div>
      </div>

      <div className="surface overflow-hidden rounded-xl">
        <table className="data">
          <thead>
            <tr>
              <th>名称</th>
              <th>Slug</th>
              <th>描述</th>
              <th>排序</th>
              <th>Skill 数</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-xs text-muted">
                  还没有类别
                </td>
              </tr>
            )}
            {list.map((c, i) => (
              <CategoryRow
                key={c.id}
                category={c}
                onChanged={(next) => {
                  setList((arr) => arr.map((x, j) => (j === i ? next : x)));
                }}
                onDeleted={() => {
                  setList((arr) => arr.filter((_, j) => j !== i));
                  router.refresh();
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CategoryRow({
  category,
  onChanged,
  onDeleted,
}: {
  category: Category;
  onChanged: (next: Category) => void;
  onDeleted: () => void;
}) {
  const [draft, setDraft] = useState(category);
  const [pending, startTransition] = useTransition();
  const dirty =
    draft.name !== category.name ||
    draft.description !== category.description ||
    draft.sortOrder !== category.sortOrder;

  function save() {
    startTransition(async () => {
      const res = await fetch(`/api/admin/categories/${category.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          description: draft.description,
          sortOrder: draft.sortOrder,
        }),
      });
      if (!res.ok) {
        pushToast('error', '保存失败');
        return;
      }
      pushToast('success', '已保存');
      onChanged(draft);
    });
  }

  function remove() {
    if (category.skillCount > 0) {
      if (!confirm(`这个类别下还有 ${category.skillCount} 个 Skill，删除后它们将变为"未分类"。继续？`)) {
        return;
      }
    } else if (!confirm('确定要删除？')) {
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/admin/categories/${category.id}`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', '删除失败');
        return;
      }
      pushToast('success', '已删除');
      onDeleted();
    });
  }

  return (
    <tr>
      <td>
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="h-7 w-full rounded border border-transparent bg-transparent px-1 text-sm transition hover:border-zinc-200 focus:border-accent-500 focus:bg-white dark:hover:border-zinc-800 dark:focus:bg-zinc-900"
        />
      </td>
      <td className="font-mono text-[11px] text-muted">{category.slug}</td>
      <td>
        <input
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          className="h-7 w-full rounded border border-transparent bg-transparent px-1 text-xs transition hover:border-zinc-200 focus:border-accent-500 focus:bg-white dark:hover:border-zinc-800 dark:focus:bg-zinc-900"
        />
      </td>
      <td>
        <input
          type="number"
          value={draft.sortOrder}
          onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })}
          className="h-7 w-16 rounded border border-transparent bg-transparent px-1 text-right font-mono text-xs tabular-nums transition hover:border-zinc-200 focus:border-accent-500 focus:bg-white dark:hover:border-zinc-800 dark:focus:bg-zinc-900"
        />
      </td>
      <td className="font-mono text-[11px] tabular-nums">{category.skillCount}</td>
      <td>
        <div className="flex items-center gap-1">
          {dirty && (
            <button
              onClick={save}
              disabled={pending}
              className="flex h-6 items-center gap-1 rounded bg-accent-500 px-2 text-[11px] text-white hover:bg-accent-600 disabled:opacity-60"
            >
              <Save className="h-3 w-3" />
              保存
            </button>
          )}
          <button
            onClick={remove}
            disabled={pending}
            className="flex h-6 items-center gap-1 rounded border border-danger/40 px-2 text-[11px] text-danger hover:bg-danger/10 disabled:opacity-60"
          >
            <Trash2 className="h-3 w-3" />
            删除
          </button>
        </div>
      </td>
    </tr>
  );
}
