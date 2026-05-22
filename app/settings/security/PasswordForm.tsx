'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      pushToast('error', '两次密码不一致');
      return;
    }
    if (next.length < 8) {
      pushToast('error', '密码至少 8 位');
      return;
    }
    startTransition(async () => {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ current: hasPassword ? current : undefined, next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const map: Record<string, string> = {
          current_required: '请输入当前密码',
          wrong_password: '当前密码错误',
        };
        pushToast('error', map[data.error] ?? '保存失败');
        return;
      }
      setCurrent('');
      setNext('');
      setConfirm('');
      pushToast('success', '密码已更新');
    });
  }

  return (
    <form onSubmit={submit} className="surface space-y-3 rounded-2xl p-5">
      {hasPassword && (
        <Field label="当前密码">
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
            className="input"
          />
        </Field>
      )}
      <Field label="新密码">
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
          className="input"
        />
      </Field>
      <Field label="确认新密码">
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
          className="input"
        />
      </Field>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {hasPassword ? '更新密码' : '设置密码'}
        </button>
      </div>
      <style jsx>{`
        .input {
          width: 100%;
          height: 2.5rem;
          padding: 0 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid rgb(var(--border));
          background: rgb(var(--surface));
          font-size: 0.875rem;
          transition: border-color 150ms;
        }
        .input:focus {
          border-color: rgb(var(--accent));
          outline: none;
          box-shadow: 0 0 0 3px rgb(var(--accent) / 0.15);
        }
      `}</style>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
