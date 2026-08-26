'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import { FileDropZone } from '@/app/skills/_components/FileDropZone';
import {
  type StagedFile,
  hasSkillMd,
  findSkillMd,
  buildZip,
  parseFrontmatterLite,
  MAX_PACKAGE_BYTES,
} from '@/app/skills/_components/staged';

export function VersionUploader({ slug, currentVersion }: { slug: string; currentVersion: string | null }) {
  const router = useRouter();
  const t = useTranslations('skill_manage');
  const ts = useTranslations('settings');
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [changelog, setChangelog] = useState('');
  const [detected, setDetected] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function onChange(next: StagedFile[]) {
    setStaged(next);
    const sm = findSkillMd(next);
    if (!sm) {
      setDetected(null);
      return;
    }
    const text = sm.file ? await sm.file.text() : sm.bytes ? new TextDecoder().decode(sm.bytes) : '';
    setDetected(parseFrontmatterLite(text).version ?? null);
  }

  function submit() {
    if (!hasSkillMd(staged)) {
      pushToast('error', t('missing_skill_md'));
      return;
    }
    start(async () => {
      const zip = await buildZip(staged);
      if (zip.size > MAX_PACKAGE_BYTES) {
        pushToast('error', t('package_too_large', { size: (zip.size / 1024 / 1024).toFixed(1) }));
        return;
      }
      const form = new FormData();
      form.set('file', zip);
      form.set('changelog', changelog);
      const res = await fetch(`/api/skills/${slug}/versions`, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reasons: Record<string, string> = {
          version_not_increasing: t('err_version_not_increasing', { current: String(data.current), got: String(data.got) }),
          version_exists: t('err_version_exists', { version: String(data.version) }),
          invalid_version: t('err_invalid_version'),
          parse_failed: t('err_parse_failed', { reason: data.reason ?? '' }),
          too_large: t('err_too_large'),
        };
        pushToast('error', reasons[data.error] ?? data.error ?? ts('upload_failed'));
        return;
      }
      pushToast('success', t('version_published', { version: data.version.version }));
      setStaged([]);
      setChangelog('');
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {detected && (
        <div className="text-xs text-muted">
          {t('detected_version')}
          <span className="font-mono text-zinc-900 dark:text-zinc-50">v{detected}</span>
        </div>
      )}
      <FileDropZone staged={staged} onChange={onChange} title={t('upload_new_version')} />
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">{t('changelog_label')}</label>
        <input
          value={changelog}
          onChange={(e) => setChangelog(e.target.value)}
          placeholder={t('changelog_placeholder')}
          className="w-full rounded-lg border border-zinc-300 bg-[rgb(var(--surface))] px-3 py-2 text-sm outline-none transition focus:border-zinc-900 dark:focus:border-zinc-100 dark:border-zinc-700"
        />
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          disabled={pending || !hasSkillMd(staged)}
          onClick={submit}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 text-sm font-medium text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-60"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('publish_new_version')}
        </button>
      </div>
    </div>
  );
}
