'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Upload, X } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { Avatar } from '@/components/Avatar';

interface User {
  handle: string;
  email: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  authMethod: 'password' | 'huawei_sso' | 'both';
  huaweiW3Id: string | null;
  huaweiW3Name: string | null;
}

export function ProfileForm({ user }: { user: User }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? '');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  async function onPickFile(file: File) {
    if (!file.type.startsWith('image/')) {
      pushToast('error', '请选择图片文件');
      return;
    }
    setUploading(true);
    try {
      const res = await fetch('/api/uploads/image', {
        method: 'POST',
        headers: { 'content-type': file.type, 'x-filename': encodeURIComponent(file.name) },
        body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        pushToast('error', data.error === 'too_large' ? '图片过大（上限 10MB）' : data.error ?? '上传失败');
        return;
      }
      setAvatarUrl(data.url);
      pushToast('success', '头像已上传，点「保存」生效');
    } catch {
      pushToast('error', '上传失败');
    } finally {
      setUploading(false);
    }
  }

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
      {user.huaweiW3Name && (
        <Field label="W3 姓名（不可改）">
          <input value={user.huaweiW3Name} disabled className="input text-muted" />
        </Field>
      )}
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
      {/* Avatar uploader — NOT wrapped in <Field>'s <label>, so clicks don't
          accidentally trigger the hidden file input. */}
      <div className="block">
        <span className="mb-1 block text-xs font-medium text-muted">头像</span>
        <div className="flex items-center gap-4">
          <Avatar name={displayName || user.displayName} src={avatarUrl || null} size="xl" />
          <div className="flex flex-col gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickFile(f);
                e.target.value = '';
              }}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 text-sm font-medium transition hover:border-accent-500 disabled:opacity-60 dark:border-zinc-700"
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                上传头像
              </button>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={() => setAvatarUrl('')}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm text-muted transition hover:text-danger"
                >
                  <X className="h-3.5 w-3.5" />
                  移除
                </button>
              )}
            </div>
            <span className="text-[11px] text-muted">支持 JPG / PNG / WebP / GIF，最大 10MB。</span>
          </div>
        </div>
      </div>
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
