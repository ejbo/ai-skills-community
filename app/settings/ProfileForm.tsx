'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

interface User {
  handle: string;
  email: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  authMethod: 'password' | 'huawei_sso' | 'both';
  huaweiW3Id: string | null;
}

export function ProfileForm({ user }: { user: User }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? '');
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await fetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName, bio, avatarUrl }),
      });
      if (!res.ok) {
        pushToast('error', '保存失败');
        return;
      }
      pushToast('success', '已保存');
      router.refresh();
    });
  }

  return (
    <div className="surface space-y-4 rounded-2xl p-5">
      <Field label="邮箱（不可改）">
        <input value={user.email} disabled className="input text-muted" />
      </Field>
      <Field label="Handle（不可改）">
        <div className="flex items-center gap-2">
          <input value={user.handle} disabled className="input font-mono text-muted" />
          <Link href={`/users/${user.handle}`} className="shrink-0 text-xs text-accent-600 hover:underline">
            查看主页 →
          </Link>
        </div>
      </Field>
      <Field label="登录方式">
        <input
          value={
            user.authMethod === 'both'
              ? `密码 + W3 (${user.huaweiW3Id})`
              : user.authMethod === 'huawei_sso'
                ? `W3 (${user.huaweiW3Id})`
                : '邮箱密码'
          }
          disabled
          className="input text-muted"
        />
      </Field>
      <Field label="显示名">
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="input" />
      </Field>
      <Field label="简介">
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, 240))}
          rows={3}
          maxLength={240}
          placeholder="一两句话介绍你自己"
          className="input"
        />
      </Field>
      <Field label="头像 URL">
        <input
          value={avatarUrl}
          onChange={(e) => setAvatarUrl(e.target.value)}
          placeholder="https://..."
          className="input"
        />
      </Field>
      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={pending}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          保存
        </button>
      </div>
      <style jsx>{`
        .input {
          width: 100%;
          min-height: 2.5rem;
          padding: 0.5rem 0.75rem;
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
        .input:disabled {
          background: rgb(var(--border) / 0.2);
          cursor: not-allowed;
        }
      `}</style>
    </div>
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
