'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

export interface PrefValues {
  inAppCommentReply: boolean;
  inAppAccessRequest: boolean;
  inAppAccessDecision: boolean;
  inAppAnnouncement: boolean;
  emailCommentReply: boolean;
  emailAccessRequest: boolean;
  emailAccessDecision: boolean;
  emailAnnouncement: boolean;
}

// One row per notification category; each has an in-app key and an email key.
const ROWS: { label: string; hint: string; inApp: keyof PrefValues; email: keyof PrefValues }[] = [
  {
    label: '评论 / 回复',
    hint: '你的评论被回复、你的回复被回复',
    inApp: 'inAppCommentReply',
    email: 'emailCommentReply',
  },
  {
    label: '收到访问申请',
    hint: '有人申请下载你发布的受限 Skill',
    inApp: 'inAppAccessRequest',
    email: 'emailAccessRequest',
  },
  {
    label: '申请结果',
    hint: '你的下载申请被通过 / 拒绝 / 撤销',
    inApp: 'inAppAccessDecision',
    email: 'emailAccessDecision',
  },
  {
    label: '更新公告',
    hint: '管理员发布的平台更新公告',
    inApp: 'inAppAnnouncement',
    email: 'emailAnnouncement',
  },
];

export function NotificationPreferenceForm({ initial }: { initial: PrefValues }) {
  const [values, setValues] = useState<PrefValues>(initial);
  const [pending, startTransition] = useTransition();

  function toggle(key: keyof PrefValues) {
    setValues((v) => ({ ...v, [key]: !v[key] }));
  }

  function save() {
    startTransition(async () => {
      try {
        const res = await fetch('/api/settings/notification-preferences', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(values),
        });
        if (!res.ok) throw new Error();
        pushToast('success', '已保存');
      } catch {
        pushToast('error', '保存失败，请稍后再试');
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="surface overflow-hidden rounded-2xl">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-b border-zinc-100 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted dark:border-zinc-800">
          <span>类型</span>
          <span className="w-14 text-center">站内</span>
          <span className="w-14 text-center">邮件</span>
        </div>
        {ROWS.map((row) => (
          <div
            key={row.inApp}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-b border-zinc-100 px-4 py-3 last:border-b-0 dark:border-zinc-800"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium">{row.label}</div>
              <div className="text-xs text-muted">{row.hint}</div>
            </div>
            <div className="flex w-14 justify-center">
              <Toggle checked={values[row.inApp]} onChange={() => toggle(row.inApp)} />
            </div>
            <div className="flex w-14 justify-center">
              <Toggle checked={values[row.email]} onChange={() => toggle(row.email)} />
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={save}
        disabled={pending}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
      >
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        保存
      </button>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative h-5 w-9 shrink-0 rounded-full transition ${
        checked ? 'bg-accent-500' : 'bg-zinc-300 dark:bg-zinc-700'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
          checked ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}
