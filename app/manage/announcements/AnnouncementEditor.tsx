'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Megaphone, Pencil, Save, Send, Trash2, X } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { RichTextEditor } from '@/components/RichTextEditor';

export interface AnnouncementRow {
  id: string;
  title: string;
  bodyMd: string;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  author: string;
}

export function AnnouncementEditor({ announcements }: { announcements: AnnouncementRow[] }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);

  function submit(publish: boolean) {
    if (!title.trim()) {
      pushToast('error', '请填写标题');
      return;
    }
    if (publish && !confirm('发布后会通知所有用户，确定发布？')) return;
    startTransition(async () => {
      const res = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, bodyMd: body, publish }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data.error ?? '操作失败');
        return;
      }
      pushToast('success', publish ? `已发布，通知 ${data.fanout?.inApp ?? 0} 人` : '已存草稿');
      setTitle('');
      setBody('');
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="surface space-y-3 rounded-2xl p-4">
        <h3 className="text-sm font-semibold">新建公告</h3>
        <input
          placeholder="标题"
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 200))}
          className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        />
        <RichTextEditor value={body} onChange={setBody} variant="full" maxLength={40000} ariaLabel="公告正文" />
        <div className="flex items-center gap-2">
          <button
            onClick={() => submit(true)}
            disabled={pending}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Megaphone className="h-3.5 w-3.5" />}
            发布
          </button>
          <button
            onClick={() => submit(false)}
            disabled={pending}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 px-4 text-sm font-medium transition hover:border-accent-500 disabled:opacity-60 dark:border-zinc-700"
          >
            存草稿
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {announcements.length === 0 && <p className="text-sm text-muted">还没有公告。</p>}
        {announcements.map((a) =>
          editingId === a.id ? (
            <EditRow key={a.id} announcement={a} onClose={() => setEditingId(null)} />
          ) : (
            <ViewRow key={a.id} announcement={a} onEdit={() => setEditingId(a.id)} />
          ),
        )}
      </div>
    </div>
  );
}

function ViewRow({ announcement: a, onEdit }: { announcement: AnnouncementRow; onEdit: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function setPublish(publish: boolean) {
    if (publish && !confirm('发布后会通知所有用户，确定发布？')) return;
    startTransition(async () => {
      const res = await fetch(`/api/admin/announcements/${a.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publish }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data.error ?? '操作失败');
        return;
      }
      pushToast('success', publish ? `已发布，通知 ${data.fanout?.inApp ?? 0} 人` : '已取消发布');
      router.refresh();
    });
  }

  function remove() {
    if (!confirm('确定删除这条公告？')) return;
    startTransition(async () => {
      const res = await fetch(`/api/admin/announcements/${a.id}`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', '删除失败');
        return;
      }
      pushToast('success', '已删除');
      router.refresh();
    });
  }

  return (
    <div className="surface flex items-center gap-3 rounded-xl p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{a.title}</span>
          {a.published ? (
            <span className="rounded-full bg-ok/10 px-2 py-0.5 text-[10px] font-semibold text-ok">已发布</span>
          ) : (
            <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
              草稿
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-muted">{a.author}</div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onEdit}
          disabled={pending}
          className="flex h-7 items-center gap-1 rounded border border-zinc-300 px-2 text-[11px] transition hover:border-accent-500 disabled:opacity-60 dark:border-zinc-700"
        >
          <Pencil className="h-3 w-3" />
          编辑
        </button>
        {a.published ? (
          <button
            onClick={() => setPublish(false)}
            disabled={pending}
            className="flex h-7 items-center gap-1 rounded border border-zinc-300 px-2 text-[11px] transition hover:border-warn disabled:opacity-60 dark:border-zinc-700"
          >
            取消发布
          </button>
        ) : (
          <button
            onClick={() => setPublish(true)}
            disabled={pending}
            className="flex h-7 items-center gap-1 rounded bg-accent-500 px-2 text-[11px] text-white transition hover:bg-accent-600 disabled:opacity-60"
          >
            <Send className="h-3 w-3" />
            发布
          </button>
        )}
        <button
          onClick={remove}
          disabled={pending}
          className="flex h-7 items-center gap-1 rounded border border-danger/40 px-2 text-[11px] text-danger transition hover:bg-danger/10 disabled:opacity-60"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function EditRow({ announcement: a, onClose }: { announcement: AnnouncementRow; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(a.title);
  const [body, setBody] = useState(a.bodyMd);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await fetch(`/api/admin/announcements/${a.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, bodyMd: body }),
      });
      if (!res.ok) {
        pushToast('error', '保存失败');
        return;
      }
      pushToast('success', '已保存');
      onClose();
      router.refresh();
    });
  }

  return (
    <div className="surface space-y-3 rounded-xl p-4">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, 200))}
        className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
      />
      <RichTextEditor value={body} onChange={setBody} variant="full" maxLength={40000} ariaLabel="公告正文" />
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={pending}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent-500 px-3 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          保存
        </button>
        <button
          onClick={onClose}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 text-sm font-medium transition hover:border-zinc-400 dark:border-zinc-700"
        >
          <X className="h-3.5 w-3.5" />
          取消
        </button>
      </div>
    </div>
  );
}
