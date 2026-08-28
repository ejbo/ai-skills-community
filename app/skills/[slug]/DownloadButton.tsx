'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { loginHref } from '@/lib/auth/callback-path';
import { Download, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';

/**
 * Downloads the gated skill bundle. Unlike a plain `<a download href="/raw">`,
 * this checks the response first: on success it saves the zip (with the proper
 * filename); on an auth/permission/not-found error it shows a clear message and
 * redirects to login instead of silently saving the JSON error body as
 * `raw.json` (which is what a bare `<a download>` does on a non-2xx response).
 */
export function DownloadButton({
  slug,
  version,
  className,
}: {
  slug: string;
  version?: string;
  className?: string;
}) {
  const t = useTranslations('skill_detail');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const url = `/api/skills/${slug}/raw${version ? `?version=${encodeURIComponent(version)}` : ''}`;
      const res = await fetch(url, { credentials: 'same-origin' });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string; message?: string });
        if (res.status === 401) {
          pushToast('error', t('session_expired'));
          router.push(loginHref(`/skills/${slug}`));
        } else if (res.status === 403) {
          pushToast('error', data.message ?? t('restricted_need_approval'));
        } else {
          pushToast('error', data.message ?? data.error ?? t('download_failed'));
        }
        return;
      }

      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') ?? '';
      const match = cd.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] ?? `${slug}${version ? `-${version}` : ''}.zip`;

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      pushToast('error', t('download_failed_network'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={download} disabled={busy} className={className}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      {t('download_zip')}
    </button>
  );
}
