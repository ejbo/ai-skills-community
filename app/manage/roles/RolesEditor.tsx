'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { pushToast } from '@/components/Toaster';
import {
  MEMBER_ROLE_KEY,
  PERMISSIONS,
  PERMISSION_GROUPS,
  ROLE_KEY_RE,
  SUPER_ADMIN_ROLE_KEY,
} from '@/lib/permissions';

export interface RoleView {
  id: string;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
  sortOrder: number;
  userCount: number;
}

const ERROR_TEXT: Record<string, string> = {
  invalid_key: '标识格式不合法：小写字母开头，仅字母/数字/下划线，2–32 位',
  reserved_key: '该标识为系统保留',
  key_taken: '标识已被使用',
  invalid_name: '名称不能为空且不超过 40 字',
  system_key_locked: '系统角色的标识不可修改',
  system_permissions_locked: '该系统角色的权限不可修改',
  role_in_use: '仍有用户持有该角色，请先在用户详情页改派',
  system_role: '系统角色不可删除',
  not_found: '角色不存在',
  forbidden: '仅超级管理员可操作',
  invalid_input: '输入不合法',
};

async function errorText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return (body?.error && ERROR_TEXT[body.error]) || '保存失败';
}

export function RolesEditor({ roles }: { roles: RoleView[] }) {
  const [selectedId, setSelectedId] = useState<string | 'new'>(roles[0]?.id ?? 'new');
  const selected = selectedId === 'new' ? null : (roles.find((r) => r.id === selectedId) ?? null);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
      <aside className="surface rounded-xl p-2">
        <ul className="space-y-0.5">
          {roles.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setSelectedId(r.id)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition ${
                  r.id === selectedId
                    ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white'
                    : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/60'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{r.name}</span>
                  {r.isSystem && (
                    <span className="badge shrink-0" style={{ background: '#f4f4f5', color: '#71717a' }}>
                      系统
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">
                  {r.key === SUPER_ADMIN_ROLE_KEY ? '全部' : r.permissions.length} 权限 · {r.userCount} 人
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setSelectedId('new')}
          className={`mt-2 w-full rounded-lg border border-dashed px-3 py-2 text-[13px] transition ${
            selectedId === 'new'
              ? 'border-zinc-400 text-zinc-900 dark:border-zinc-500 dark:text-white'
              : 'border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-800 dark:border-zinc-700 dark:hover:text-zinc-200'
          }`}
        >
          ＋ 新建角色
        </button>
      </aside>

      {/* key= resets the form whenever the selection OR the selected role's saved data changes
          (after create the new id is selected before router.refresh() delivers the row, so the
          key must also change once the row arrives — otherwise the form keeps its empty state). */}
      <RoleForm
        key={selected ? `${selected.id}:${selected.key}:${selected.name}:${selected.sortOrder}:${selected.permissions.join('|')}` : `new:${selectedId}`}
        role={selected}
        onSaved={(id) => setSelectedId(id)}
        onDeleted={() => setSelectedId(roles[0]?.id ?? 'new')}
      />
    </div>
  );
}

function RoleForm({
  role,
  onSaved,
  onDeleted,
}: {
  role: RoleView | null;
  onSaved: (id: string) => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const isNew = role === null;
  const isSuper = role?.key === SUPER_ADMIN_ROLE_KEY;
  const isMember = role?.key === MEMBER_ROLE_KEY;
  const permissionsLocked = isSuper || isMember;

  const [name, setName] = useState(role?.name ?? '');
  const [key, setKey] = useState(role?.key ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [sortOrder, setSortOrder] = useState(String(role?.sortOrder ?? 100));
  const [perms, setPerms] = useState<Set<string>>(() => new Set(isSuper ? PERMISSIONS.map((p) => p.key) : (role?.permissions ?? [])));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  function togglePerm(k: string) {
    if (permissionsLocked) return;
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function setGroup(groupKey: string, on: boolean) {
    if (permissionsLocked) return;
    setPerms((prev) => {
      const next = new Set(prev);
      for (const p of PERMISSIONS) if (p.group === groupKey) (on ? next.add(p.key) : next.delete(p.key));
      return next;
    });
  }

  function save() {
    const trimmedName = name.trim();
    if (!trimmedName) return pushToast('error', ERROR_TEXT.invalid_name);
    if ((isNew || !role?.isSystem) && !ROLE_KEY_RE.test(key.trim().toLowerCase())) {
      return pushToast('error', ERROR_TEXT.invalid_key);
    }
    const order = Number(sortOrder);
    if (!Number.isInteger(order)) return pushToast('error', '排序必须是整数');

    const payload: Record<string, unknown> = {
      name: trimmedName,
      description: description.trim() || null,
      sortOrder: order,
    };
    if (isNew || !role?.isSystem) payload.key = key.trim().toLowerCase();
    if (!permissionsLocked) payload.permissions = Array.from(perms);

    startTransition(async () => {
      const res = await fetch(isNew ? '/api/admin/roles' : `/api/admin/roles/${role!.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return pushToast('error', await errorText(res));
      const body = (await res.json()) as { role: { id: string } };
      pushToast('success', isNew ? '角色已创建' : '角色已保存');
      onSaved(body.role.id);
      router.refresh();
    });
  }

  function remove() {
    if (!role || role.isSystem) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/admin/roles/${role.id}`, { method: 'DELETE' });
      if (!res.ok) {
        setConfirmDelete(false);
        return pushToast('error', await errorText(res));
      }
      pushToast('success', `角色「${role.name}」已删除`);
      onDeleted();
      router.refresh();
    });
  }

  const inputCls =
    'h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900';

  return (
    <section className="surface space-y-5 rounded-xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{isNew ? '新建角色' : role.name}</h3>
          {!isNew && (
            <p className="mt-0.5 text-xs text-muted">
              {role.userCount > 0 ? (
                <Link href={`/manage/users?role=${encodeURIComponent(role.key)}`} className="underline">
                  {role.userCount} 位用户持有
                </Link>
              ) : (
                '暂无用户持有'
              )}
              {role.isSystem && ' · 系统角色'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isNew && !role.isSystem && (
            <button
              type="button"
              onClick={remove}
              disabled={pending || role.userCount > 0}
              title={role.userCount > 0 ? '仍有用户持有该角色，请先改派' : undefined}
              className="h-8 rounded-lg border border-red-200 px-3 text-xs text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
            >
              {confirmDelete ? '确认删除' : '删除角色'}
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="h-8 rounded-lg bg-zinc-900 px-4 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {isNew ? '创建' : '保存'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs">
          <span className="text-muted">名称</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className={inputCls} placeholder="例如：内容管理员" />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted">标识（key，用于筛选与日志；系统角色不可改）</span>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={!isNew && role.isSystem}
            maxLength={32}
            className={`${inputCls} font-mono`}
            placeholder="content_admin"
          />
        </label>
        <label className="space-y-1 text-xs sm:col-span-2">
          <span className="text-muted">描述</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} className={inputCls} placeholder="这个角色负责什么" />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted">排序（越小越靠前）</span>
          <input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} inputMode="numeric" className={`${inputCls} w-32 font-mono`} />
        </label>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">权限</h4>
          {permissionsLocked && (
            <span className="text-[11px] text-muted">
              {isSuper ? '超级管理员始终拥有全部权限，不可修改。' : '普通成员始终没有权限，不可修改。'}
            </span>
          )}
        </div>
        {PERMISSION_GROUPS.map((g) => {
          const items = PERMISSIONS.filter((p) => p.group === g.key);
          const onCount = items.filter((p) => perms.has(p.key)).length;
          return (
            <div key={g.key} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">
                    {g.label}
                    <span className="ml-2 font-mono text-[11px] text-muted tabular-nums">
                      {onCount}/{items.length}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted">{g.hint}</div>
                </div>
                {!permissionsLocked && (
                  <div className="flex shrink-0 gap-1 text-[11px]">
                    <button type="button" onClick={() => setGroup(g.key, true)} className="rounded border border-zinc-200 px-2 py-0.5 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
                      全选
                    </button>
                    <button type="button" onClick={() => setGroup(g.key, false)} className="rounded border border-zinc-200 px-2 py-0.5 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
                      清空
                    </button>
                  </div>
                )}
              </div>
              <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                {items.map((p) => (
                  <li key={p.key}>
                    <label
                      className={`flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 transition ${
                        permissionsLocked ? 'cursor-default opacity-70' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={perms.has(p.key)}
                        onChange={() => togglePerm(p.key)}
                        disabled={permissionsLocked}
                        className="mt-0.5 h-3.5 w-3.5 accent-zinc-900 dark:accent-white"
                      />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium">
                          {p.label}
                          <span className="ml-1.5 font-mono text-[10px] text-muted">{p.key}</span>
                        </span>
                        <span className="block text-[11px] leading-snug text-muted">{p.description}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
