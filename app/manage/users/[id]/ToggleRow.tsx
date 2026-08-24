'use client';

import { useState, useTransition } from 'react';
import { pushToast } from '@/components/Toaster';

type Field = 'isActive' | 'canPublishSkills' | 'canRemix' | 'canUseCli';

type NumberField = 'dailyDownloadLimit' | 'dailyPublishLimit';

const ERROR_TEXT: Record<string, string> = {
  staff_target_requires_super: '管理员账号仅超级管理员可修改',
  conflict: '操作冲突，请重试',
  self_disable: '不能停用自己的账号',
  last_super_admin: '至少保留一位启用的超级管理员',
  use_role_endpoint: '请通过「角色」下拉框调整',
  forbidden: '没有权限',
};

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return (body?.error && ERROR_TEXT[body.error]) || '保存失败';
}

export function ToggleRow({
  userId,
  field,
  label,
  current,
  disabledReason,
}: {
  userId: string;
  field: Field;
  label: string;
  current: boolean;
  /** When set, the switch is rendered inert with this hint (e.g. staff target, non-super viewer). */
  disabledReason?: string | null;
}) {
  const [value, setValue] = useState(current);
  const [, startTransition] = useTransition();

  function toggle() {
    if (disabledReason) return;
    const prev = value;
    const next = !value;
    setValue(next);
    startTransition(async () => {
      const res = await fetch(`/api/admin/users/${userId}/toggle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field, value: next }),
      });
      if (!res.ok) {
        setValue(prev);
        pushToast('error', await readError(res));
      } else {
        pushToast('success', `${label} 已${next ? '开启' : '关闭'}`);
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-sm">
        {label}
        {disabledReason && <span className="ml-2 text-[11px] text-muted">（{disabledReason}）</span>}
      </span>
      <button
        onClick={toggle}
        aria-label={label}
        aria-disabled={Boolean(disabledReason)}
        className={`toggle ${disabledReason ? 'cursor-not-allowed opacity-50' : ''}`}
        data-on={value}
      />
    </div>
  );
}

export function NumberRow({
  userId,
  field,
  label,
  current,
  disabledReason,
}: {
  userId: string;
  field: NumberField;
  label: string;
  current: number | null;
  disabledReason?: string | null;
}) {
  const [value, setValue] = useState<string>(current?.toString() ?? '');
  const [pending, startTransition] = useTransition();

  function save() {
    if (disabledReason) return;
    const parsed = value.trim() === '' ? null : Number(value);
    if (parsed !== null && (isNaN(parsed) || parsed < 0)) {
      pushToast('error', '请输入非负整数');
      return;
    }
    if (parsed === current) return;
    startTransition(async () => {
      const res = await fetch(`/api/admin/users/${userId}/toggle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field, value: parsed }),
      });
      if (!res.ok) {
        pushToast('error', await readError(res));
      } else {
        pushToast('success', `${label} 已更新`);
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-sm">
        {label}
        {disabledReason && <span className="ml-2 text-[11px] text-muted">（{disabledReason}）</span>}
      </span>
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder="无限制"
          disabled={pending || Boolean(disabledReason)}
          className="h-7 w-24 rounded border border-zinc-200 bg-white px-2 text-right font-mono text-[12px] tabular-nums disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900"
        />
      </div>
    </div>
  );
}
