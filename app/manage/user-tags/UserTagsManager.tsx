'use client';

// 用户标签（徽章）管理 — create, edit in place, assign, delete.
//
// A tag is what members see as a BADGE on every 名片: an icon, a name, a colour
// and a 说明 that opens on hover. So the editor previews the real <BadgeChip/>
// (same component the card and profile render, hover detail included) instead
// of a lookalike pill — what the admin sees here is what a member will see.
// System (auto) tags can be renamed, described, recoloured and given an icon,
// but never re-keyed, assigned by hand or deleted (the API enforces all three).

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Pencil, Plus, RotateCcw, Trash2, Users, X } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { BadgeChip } from '@/components/user/BadgeChip';
import { BADGE_ICON_COMPONENTS } from '@/components/user/badge-icons';
import { BADGE_ICONS, isBadgeIcon, type BadgeIcon } from '@/lib/profile/shared';
import type { ProfileBadge } from '@/lib/profile/types';
import { TAG_COLORS, TAG_DESCRIPTION_MAX, tagColorClass, type TagColor } from '@/lib/user-tags';

export interface ManagedTag {
  id: string;
  key: string;
  name: string;
  description: string;
  color: string;
  icon: string | null;
  kind: 'manual' | 'auto';
  sortOrder: number;
  assignedCount: number;
}

interface TagDraft {
  key: string;
  name: string;
  description: string;
  color: string;
  icon: BadgeIcon | null;
  sortOrder: number;
}

const NAME_MAX = 24;

const COLOR_LABEL: Record<TagColor, string> = {
  zinc: '石墨',
  blue: '蓝',
  green: '绿',
  amber: '琥珀',
  rose: '玫红',
  violet: '紫',
};

const input =
  'h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-100';
const label = 'mb-1.5 block text-xs font-medium text-muted';
const btnPrimary =
  'flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';
const btnSecondary =
  'flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm transition hover:border-zinc-400 disabled:opacity-60 dark:border-zinc-700 dark:hover:border-zinc-500';

const EMPTY_DRAFT: TagDraft = { key: '', name: '', description: '', color: 'zinc', icon: null, sortOrder: 100 };

function draftOf(tag: ManagedTag): TagDraft {
  return {
    key: tag.key,
    name: tag.name,
    description: tag.description,
    color: tag.color,
    icon: isBadgeIcon(tag.icon) ? tag.icon : null,
    sortOrder: tag.sortOrder,
  };
}

function badgeOf(d: TagDraft, kind: 'manual' | 'auto'): ProfileBadge {
  return {
    key: d.key || 'preview',
    name: d.name.trim() || '徽章名称',
    description: d.description.trim() || null,
    color: d.color,
    icon: d.icon,
    kind,
    grantedAt: null,
  };
}

async function readReason(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return typeof data?.reason === 'string' ? data.reason : fallback;
}

export function UserTagsManager({ tags }: { tags: ManagedTag[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<TagDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<ManagedTag | null>(null);

  const manualCount = useMemo(() => tags.filter((t) => t.kind === 'manual').length, [tags]);

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/manage/user-tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key: draft.key.trim(),
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          color: draft.color,
          icon: draft.icon,
        }),
      });
      if (!res.ok) {
        pushToast('error', await readReason(res, '创建失败'));
        return;
      }
      pushToast('success', '标签已创建');
      setDraft(EMPTY_DRAFT);
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
      const res = await fetch(`/api/manage/user-tags?id=${encodeURIComponent(tag.id)}`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', await readReason(res, '删除失败'));
        return;
      }
      pushToast('success', '标签已删除');
      if (editingId === tag.id) setEditingId(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const canCreate = !busy && /^[a-z][a-z0-9_]{1,30}$/.test(draft.key.trim()) && !!draft.name.trim();

  return (
    <div className="space-y-4">
      <section className="surface rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">新建标签</h3>
          <span className="text-xs text-muted">成员在名片上看到的就是右侧预览；悬停预览可查看说明浮层。</span>
        </div>
        <div className="mt-4">
          <TagFields value={draft} onChange={setDraft} kind="manual" keyEditable />
        </div>
        <div className="mt-4 flex justify-end border-t border-zinc-100 pt-4 dark:border-zinc-800/60">
          <button type="button" disabled={!canCreate} onClick={() => void create()} className={btnPrimary}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            创建标签
          </button>
        </div>
      </section>

      <section className="surface overflow-hidden rounded-2xl">
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800/60">
          <h3 className="shrink-0 text-sm font-semibold">全部标签</h3>
          <span className="font-mono text-xs tabular-nums text-muted">
            {tags.length} 个 · 手动 {manualCount} · 系统 {tags.length - manualCount}
          </span>
        </header>
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {tags.map((tag) =>
            editingId === tag.id ? (
              <li key={tag.id} className="bg-zinc-50/70 px-5 py-4 dark:bg-zinc-900/40">
                <TagEditor
                  tag={tag}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => {
                    setEditingId(null);
                    router.refresh();
                  }}
                />
              </li>
            ) : (
              <TagRow
                key={tag.id}
                tag={tag}
                busy={busy}
                onEdit={() => setEditingId(tag.id)}
                onAssign={() => setAssignFor(tag)}
                onRemove={() => void remove(tag)}
              />
            ),
          )}
          {tags.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted">还没有标签。</li>}
        </ul>
      </section>

      {assignFor && <AssignDialog tag={assignFor} onClose={() => setAssignFor(null)} />}
    </div>
  );
}

function TagRow({
  tag,
  busy,
  onEdit,
  onAssign,
  onRemove,
}: {
  tag: ManagedTag;
  busy: boolean;
  onEdit: () => void;
  onAssign: () => void;
  onRemove: () => void;
}) {
  const badge = useMemo(() => badgeOf(draftOf(tag), tag.kind), [tag]);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3 sm:flex-nowrap">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <BadgeChip badge={badge} size="sm" tone="surface" className="shrink-0" />
        <span className="shrink-0 font-mono text-xs text-muted">{tag.key}</span>
        {tag.kind === 'auto' && (
          <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-muted dark:bg-zinc-800">系统</span>
        )}
        <span className={`min-w-0 flex-1 truncate text-xs ${tag.description ? 'text-muted' : 'italic text-muted/60'}`}>
          {tag.description || '未填写说明（成员将看到「暂无说明」）'}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="w-12 text-right font-mono text-xs tabular-nums text-muted">{tag.assignedCount} 人</span>
        <button
          type="button"
          onClick={onEdit}
          disabled={busy}
          className="flex h-8 items-center gap-1 rounded-lg border border-zinc-200 px-2.5 text-xs transition hover:border-zinc-400 disabled:opacity-60 dark:border-zinc-700 dark:hover:border-zinc-500"
        >
          <Pencil className="h-3.5 w-3.5" />
          编辑
        </button>
        {tag.kind === 'manual' && (
          <>
            <button
              type="button"
              onClick={onAssign}
              className="flex h-8 items-center gap-1 rounded-lg border border-zinc-200 px-2.5 text-xs transition hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500"
            >
              <Users className="h-3.5 w-3.5" />
              指派
            </button>
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              aria-label={`删除标签 ${tag.name}`}
              title="删除"
              className="grid h-8 w-8 place-items-center rounded-lg border border-zinc-200 text-muted transition hover:border-danger/50 hover:text-danger disabled:opacity-60 dark:border-zinc-700"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function TagEditor({ tag, onCancel, onSaved }: { tag: ManagedTag; onCancel: () => void; onSaved: () => void }) {
  const initial = useMemo(() => draftOf(tag), [tag]);
  const [draft, setDraft] = useState<TagDraft>(initial);
  const [saving, setSaving] = useState(false);

  const dirty =
    draft.name !== initial.name ||
    draft.description !== initial.description ||
    draft.color !== initial.color ||
    draft.icon !== initial.icon ||
    draft.sortOrder !== initial.sortOrder;

  async function save() {
    if (saving || !dirty || !draft.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/manage/user-tags', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: tag.id,
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          color: draft.color,
          icon: draft.icon,
          sortOrder: draft.sortOrder,
        }),
      });
      if (!res.ok) {
        pushToast('error', await readReason(res, '保存失败'));
        return;
      }
      pushToast('success', `「${draft.name.trim()}」已更新`);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">编辑标签</span>
        <span className="font-mono text-xs text-muted">{tag.key}</span>
        {tag.kind === 'auto' && (
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-muted dark:bg-zinc-800">
            系统标签 · key 不可修改
          </span>
        )}
      </div>
      <TagFields value={draft} onChange={setDraft} kind={tag.kind} showSortOrder />
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {dirty && (
          <button type="button" onClick={() => setDraft(initial)} className={btnSecondary} disabled={saving}>
            <RotateCcw className="h-3.5 w-3.5" />
            还原
          </button>
        )}
        <button type="button" onClick={onCancel} className={btnSecondary} disabled={saving}>
          <X className="h-3.5 w-3.5" />
          取消
        </button>
        <button
          type="button"
          onClick={() => void save()}
          className={btnPrimary}
          disabled={saving || !dirty || !draft.name.trim()}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          保存
        </button>
      </div>
    </div>
  );
}

/** The fields shared by 新建 and 编辑, with the live member-facing preview. */
function TagFields({
  value,
  onChange,
  kind,
  keyEditable = false,
  showSortOrder = false,
}: {
  value: TagDraft;
  onChange: (next: TagDraft) => void;
  kind: 'manual' | 'auto';
  keyEditable?: boolean;
  showSortOrder?: boolean;
}) {
  const set = <K extends keyof TagDraft>(k: K, v: TagDraft[K]) => onChange({ ...value, [k]: v });
  const badge = badgeOf(value, kind);
  const descLen = Array.from(value.description).length;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="min-w-0 space-y-4">
        <div className={`grid gap-3 ${keyEditable ? 'sm:grid-cols-2' : ''} ${showSortOrder ? 'sm:grid-cols-[minmax(0,1fr)_7rem]' : ''}`}>
          {keyEditable && (
            <div>
              <label className={label} htmlFor="tag-key">
                key（小写英文，创建后不可改）
              </label>
              <input
                id="tag-key"
                className={`${input} font-mono`}
                placeholder="expert"
                value={value.key}
                maxLength={31}
                onChange={(e) => set('key', e.target.value.toLowerCase())}
              />
            </div>
          )}
          <div>
            <label className={label} htmlFor={`tag-name-${value.key || 'new'}`}>
              显示名
            </label>
            <input
              id={`tag-name-${value.key || 'new'}`}
              className={input}
              placeholder="如：领域专家"
              value={value.name}
              maxLength={NAME_MAX}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>
          {showSortOrder && (
            <div>
              <label className={label} htmlFor={`tag-sort-${value.key}`}>
                排序（小的在前）
              </label>
              <input
                id={`tag-sort-${value.key}`}
                type="number"
                min={0}
                max={999}
                className={`${input} font-mono tabular-nums`}
                value={value.sortOrder}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  set('sortOrder', Number.isFinite(n) ? Math.min(999, Math.max(0, n)) : 0);
                }}
              />
            </div>
          )}
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <label className={label} htmlFor={`tag-desc-${value.key || 'new'}`}>
              说明（悬停徽章时展示给成员）
            </label>
            <span
              className={`font-mono text-[11px] tabular-nums ${descLen > TAG_DESCRIPTION_MAX ? 'text-danger' : 'text-muted'}`}
            >
              {descLen}/{TAG_DESCRIPTION_MAX}
            </span>
          </div>
          <textarea
            id={`tag-desc-${value.key || 'new'}`}
            rows={2}
            className="w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-100"
            placeholder="这个称号代表什么、如何获得，例如：在知识库贡献 10 篇以上精选文档的成员。"
            value={value.description}
            maxLength={TAG_DESCRIPTION_MAX}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>

        <div>
          <span className={label}>颜色</span>
          <div role="radiogroup" aria-label="颜色" className="flex flex-wrap gap-1.5">
            {TAG_COLORS.map((c) => {
              const on = value.color === c;
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set('color', c)}
                  className={`flex h-8 items-center rounded-lg border p-1 transition ${
                    on
                      ? 'border-zinc-900 ring-1 ring-zinc-900 dark:border-zinc-100 dark:ring-zinc-100'
                      : 'border-zinc-200 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500'
                  }`}
                >
                  {/* The token's own chip — a pale -100 dot alone can't tell 蓝 from 紫. */}
                  <span className={`flex h-full items-center gap-1 rounded-md px-2 text-xs font-medium ${tagColorClass(c)}`}>
                    {on && <Check className="h-3 w-3" aria-hidden />}
                    {COLOR_LABEL[c]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <span className={label}>图标</span>
          <div
            role="radiogroup"
            aria-label="图标"
            className="grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1.5 xl:grid-cols-[repeat(21,minmax(0,1fr))]"
          >
            <button
              type="button"
              role="radio"
              aria-checked={value.icon === null}
              onClick={() => set('icon', null)}
              title="默认（按标签类型）"
              className={`flex h-9 items-center justify-center rounded-lg border text-[11px] transition ${
                value.icon === null
                  ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                  : 'border-zinc-200 text-muted hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500'
              }`}
            >
              默认
            </button>
            {BADGE_ICONS.map((key) => {
              const Icon = BADGE_ICON_COMPONENTS[key];
              const on = value.icon === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={key}
                  title={key}
                  onClick={() => set('icon', key)}
                  className={`flex h-9 items-center justify-center rounded-lg border transition ${
                    on
                      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border-zinc-200 text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-100'
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <aside className="flex min-w-0 flex-col self-start rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted">成员看到的样子</span>
        <div className="flex flex-col items-center justify-center gap-3 py-6">
          <BadgeChip badge={badge} size="md" tone="surface" />
          <div className="w-full rounded-lg bg-zinc-900 px-3 py-3 dark:bg-zinc-800">
            <div className="flex justify-center">
              <BadgeChip badge={badge} size="sm" tone="glass" />
            </div>
          </div>
        </div>
        <p className="text-[11px] leading-relaxed text-muted">
          上：主页上的徽章 · 下：深色名片上的徽章。
          {kind === 'auto' ? ' 系统标签由规则自动授予与回收。' : ''}
        </p>
      </aside>
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
        <h3 className="text-base font-semibold">指派标签「{tag.name}」</h3>
        <p className="mt-1 text-xs text-muted">粘贴工号（handle），换行、逗号或空格分隔均可。已有的不会重复指派。</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={'z0001\nz0002\nz0003'}
          className="mt-3 w-full resize-y rounded-lg border border-zinc-200 bg-white p-3 font-mono text-xs outline-none focus:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-100"
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
            className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            批量指派
          </button>
        </div>
      </div>
    </div>
  );
}
