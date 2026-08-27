'use client';

// 指定成员可见 的锁定视图 (ask #4). Rendered INSTEAD of the article whenever
// `post.accessLocked` — the payload the RSC handed us is already a stub (no
// body, summary, cover, attachments, headings or embeds; comments are never
// fetched), so this component only ever shows the title, the authors and the
// 访问密码 form.
//
// The form posts to /api/zones/<slug>/posts/<id>/unlock, which redeems the code
// server-side (creating the ZonePostViewer row) and is rate-limited hard. Every
// failure is reported with the SAME neutral message — a code that exists but is
// wrong must be indistinguishable from one that never existed.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { KeyRound, Loader2, Lock } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { pushToast } from '@/components/Toaster';
import { ACCESS_CODE_LENGTH, isValidAccessCode, normalizeAccessCode, zoneHref } from '@/lib/zones/shared';
import type { ZonePostDetailView } from '@/lib/zones/types';
import { BTN_PRIMARY, CARD_CLS, readError } from '../ui';

export function PostUnlock({ post, zone }: { post: ZonePostDetailView; zone: { slug: string; name: string } }) {
  const t = useTranslations('zones');
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authors = [post.author, ...post.coauthors];
  const ready = isValidAccessCode(code);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/zones/${encodeURIComponent(zone.slug)}/posts/${encodeURIComponent(post.id)}/unlock`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: normalizeAccessCode(code) }) },
      );
      if (res.ok) {
        pushToast('success', t('post_access_unlocked'));
        router.refresh();
        return;
      }
      const err = await readError(res);
      // Neutral by design: only rate limiting gets its own wording.
      setError(res.status === 429 || err.error.startsWith('rate_limited') ? t('post_access_rate_limited') : t('post_access_invalid'));
    } catch {
      setError(t('post_access_invalid'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <nav className="flex flex-wrap items-center gap-1.5 text-xs text-muted" aria-label={t('post_breadcrumb_aria')}>
        <Link href="/zones" className="hover:underline">
          {t('post_breadcrumb_zones')}
        </Link>
        <span>/</span>
        <Link href={zoneHref(zone.slug)} className="hover:underline">
          {zone.name}
        </Link>
      </nav>

      <div className={`${CARD_CLS} mt-4 px-6 py-10 text-center sm:px-10`}>
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-800">
          <Lock className="h-5 w-5 text-zinc-500" aria-hidden />
        </span>

        <h1 className="mt-5 break-words text-xl font-semibold tracking-tight sm:text-2xl">{post.title}</h1>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted">
          {authors.map((a, i) => (
            <span key={a.handle} className="inline-flex items-center gap-1.5">
              {i > 0 && <span aria-hidden>·</span>}
              <Avatar name={a.displayName} src={a.avatarUrl} size="xs" handle={a.handle} />
              <Link href={`/users/${a.handle}`} className="font-medium text-zinc-700 hover:underline dark:text-zinc-300">
                {a.displayName}
              </Link>
              <DeptTag department={a.department} lab={a.lab} className="relative z-[1]" />
            </span>
          ))}
        </div>

        <p className="mt-5 text-sm font-medium text-zinc-800 dark:text-zinc-200">{t('post_access_locked_title')}</p>
        <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">{t('post_access_locked_desc')}</p>
        <p className="mt-1 text-xs text-muted">{t('post_access_locked_body')}</p>

        <form onSubmit={submit} className="mx-auto mt-6 flex max-w-xs flex-col items-stretch gap-2">
          <label className="flex h-11 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 transition focus-within:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:focus-within:border-zinc-400">
            <KeyRound className="h-4 w-4 shrink-0 text-muted" aria-hidden />
            <input
              autoFocus
              value={code}
              onChange={(e) => {
                setCode(normalizeAccessCode(e.target.value).slice(0, ACCESS_CODE_LENGTH));
                setError(null);
              }}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={ACCESS_CODE_LENGTH}
              disabled={busy}
              aria-label={t('post_access_code_placeholder')}
              aria-invalid={error ? true : undefined}
              placeholder={t('post_access_code_placeholder')}
              className="min-w-0 flex-1 bg-transparent text-center font-mono text-base tracking-[0.4em] outline-none placeholder:tracking-normal placeholder:font-sans placeholder:text-sm placeholder:text-muted"
            />
          </label>
          <button type="submit" disabled={busy || !ready} className={BTN_PRIMARY}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('post_access_submit')}
          </button>
          <p className={`text-xs ${error ? 'text-danger' : 'text-muted'}`} role={error ? 'alert' : undefined}>
            {error ?? t('post_access_code_hint', { len: ACCESS_CODE_LENGTH })}
          </p>
        </form>
      </div>
    </div>
  );
}
