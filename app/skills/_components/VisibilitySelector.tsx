'use client';

import { Globe, ShieldCheck, Lock } from 'lucide-react';
import type { SkillVisibility } from '@prisma/client';

const OPTIONS: { value: SkillVisibility; label: string; Icon: typeof Globe; help: string }[] = [
  { value: 'public', label: '公开', Icon: Globe, help: '所有登录用户都能发现并自由下载。' },
  {
    value: 'restricted',
    label: '受限下载',
    Icon: ShieldCheck,
    help: '任何人可见介绍，但下载 / 查看文件需向你申请，你审批后才能获取。',
  },
  {
    value: 'private',
    label: '私密',
    Icon: Lock,
    help: '仅你本人可见、编辑、下载和测试；其他人完全看不到（管理员可在后台看到）。',
  },
];

export function VisibilitySelector({
  value,
  onChange,
}: {
  value: SkillVisibility;
  onChange: (v: SkillVisibility) => void;
}) {
  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {OPTIONS.map(({ value: v, label, Icon }) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition ${
              value === v
                ? 'border-accent-500 bg-accent-500/10 text-accent-700 dark:text-accent-300'
                : 'border-zinc-300 hover:border-zinc-400 dark:border-zinc-700'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted">{current.help}</p>
    </div>
  );
}
