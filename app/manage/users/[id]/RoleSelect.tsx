'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { pushToast } from '@/components/Toaster';

export interface RoleOption {
  id: string;
  key: string;
  name: string;
}

const ERROR_TEXT: Record<string, string> = {
  forbidden: '仅超级管理员可指派角色',
  self_change: '不能修改自己的角色',
  last_super_admin: '至少保留一位超级管理员',
  unknown_role: '角色不存在',
  not_found: '用户不存在',
};

export function RoleSelect({
  userId,
  roles,
  currentRoleId,
  disabledReason,
}: {
  userId: string;
  roles: RoleOption[];
  currentRoleId: string;
  disabledReason?: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentRoleId);
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    if (disabledReason || next === value) return;
    const prev = value;
    setValue(next);
    startTransition(async () => {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roleId: next }),
      });
      if (!res.ok) {
        setValue(prev);
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        pushToast('error', (body?.error && ERROR_TEXT[body.error]) || '保存失败');
        return;
      }
      const name = roles.find((r) => r.id === next)?.name ?? '';
      pushToast('success', `角色已更新为「${name}」`);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-sm">
        角色
        {disabledReason && <span className="ml-2 text-[11px] text-muted">（{disabledReason}）</span>}
      </span>
      <select
        value={value}
        onChange={(e) => change(e.target.value)}
        disabled={pending || Boolean(disabledReason)}
        className="h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900"
      >
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </div>
  );
}
