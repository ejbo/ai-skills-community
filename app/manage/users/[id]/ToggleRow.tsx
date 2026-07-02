'use client';

import { useState, useTransition } from 'react';
import { pushToast } from '@/components/Toaster';

type Field =
  | 'isAdmin'
  | 'isActive'
  | 'canPublishSkills'
  | 'canRemix'
  | 'canUseCli';

type NumberField = 'dailyDownloadLimit' | 'dailyPublishLimit';

export function ToggleRow({
  userId,
  field,
  label,
  current,
}: {
  userId: string;
  field: Field;
  label: string;
  current: boolean;
}) {
  const [value, setValue] = useState(current);
  const [, startTransition] = useTransition();

  function toggle() {
    const next = !value;
    setValue(next);
    startTransition(async () => {
      const res = await fetch(`/api/admin/users/${userId}/toggle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field, value: next }),
      });
      if (!res.ok) {
        setValue(current);
        pushToast('error', '保存失败');
      } else {
        pushToast('success', `${label} 已${next ? '开启' : '关闭'}`);
      }
    });
  }

  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm">{label}</span>
      <button onClick={toggle} aria-label={label} className="toggle" data-on={value} />
    </div>
  );
}

export function NumberRow({
  userId,
  field,
  label,
  current,
}: {
  userId: string;
  field: NumberField;
  label: string;
  current: number | null;
}) {
  const [value, setValue] = useState<string>(current?.toString() ?? '');
  const [pending, startTransition] = useTransition();

  function save() {
    const parsed = value.trim() === '' ? null : Number(value);
    if (parsed !== null && (isNaN(parsed) || parsed < 0)) {
      pushToast('error', '请输入非负整数');
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/admin/users/${userId}/toggle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field, value: parsed }),
      });
      if (!res.ok) {
        pushToast('error', '保存失败');
      } else {
        pushToast('success', `${label} 已更新`);
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder="无限制"
          disabled={pending}
          className="h-7 w-24 rounded border border-zinc-200 bg-white px-2 text-right font-mono text-[12px] tabular-nums dark:border-zinc-800 dark:bg-zinc-900"
        />
      </div>
    </div>
  );
}
