'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Loader2, Upload, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('settings');
  const router = useRouter();
  const { update } = useSession();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? '');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  async function onPickFile(file: File) {
    if (!file.type.startsWith('image/')) {
      pushToast('error', t('pick_image'));
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
        pushToast('error', data.error === 'too_large' ? t('image_too_large') : data.error ?? t('upload_failed'));
        return;
      }
      setAvatarUrl(data.url);
      pushToast('success', t('avatar_uploaded'));
    } catch {
      pushToast('error', t('upload_failed'));
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
        pushToast('error', t('save_failed'));
        return;
      }
      pushToast('success', t('saved'));
      // Refresh the JWT so the new avatar/name shows immediately. The session
      // callback no longer re-reads the DB every request, so this explicit update
      // is what propagates a profile change to the navbar.
      await update();
      router.refresh();
    });
  }

  return (
    <div className="surface space-y-4 rounded-2xl p-5">
      <Field label={t('email')}>
        <input value={user.email} disabled className="input text-muted" />
      </Field>
      <Field label={t('employee_id')}>
        <div className="flex items-center gap-2">
          <input value={user.handle} disabled className="input font-mono text-muted" />
          <Link href={`/users/${user.handle}`} className="shrink-0 text-xs text-accent-600 hover:underline">
            {t('view_profile')}
          </Link>
        </div>
      </Field>
      <Field label={t('login_method')}>
        <input
          value={
            user.authMethod === 'both'
              ? `${t('login_password')} + W3 (${user.huaweiW3Id})`
              : user.authMethod === 'huawei_sso'
                ? `W3 (${user.huaweiW3Id})`
                : t('login_password')
          }
          disabled
          className="input text-muted"
        />
      </Field>
      {user.huaweiW3Name && (
        <Field label={t('w3_name')}>
          <input value={user.huaweiW3Name} disabled className="input text-muted" />
        </Field>
      )}
      <Field label={t('display_name')}>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="input" />
      </Field>
      <Field label={t('bio')}>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, 240))}
          rows={3}
          maxLength={240}
          placeholder={t('bio_placeholder')}
          className="input"
        />
      </Field>
      {/* Avatar uploader — NOT wrapped in <Field>'s <label>, so clicks don't
          accidentally trigger the hidden file input. */}
      <div className="block">
        <span className="mb-1 block text-xs font-medium text-muted">{t('avatar')}</span>
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
                {t('upload_avatar')}
              </button>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={() => setAvatarUrl('')}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm text-muted transition hover:text-danger"
                >
                  <X className="h-3.5 w-3.5" />
                  {t('remove')}
                </button>
              )}
            </div>
            <span className="text-[11px] text-muted">{t('avatar_hint')}</span>
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
          {t('save')}
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
