'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Check, Copy, Terminal } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { pushToast } from '@/components/Toaster';
import { copyText } from '@/lib/clipboard';
import type { EmbedSkillData } from '@/lib/zones/types';
import { fmtCount } from '@/components/zones/embeds/EmbedCard';

/** Mono install-command block with a copy button (InstallSnippet look, zone-neutral). */
export function InstallSnippet({ cmd }: { cmd: string }) {
  const t = useTranslations('zones');
  const tc = useTranslations('common');
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <Terminal className="h-4 w-4 shrink-0 text-muted" />
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-800 dark:text-zinc-200">{cmd}</code>
      <button
        type="button"
        onClick={async () => {
          const ok = await copyText(cmd);
          if (ok) {
            setCopied(true);
            pushToast('success', tc('copied'));
            setTimeout(() => setCopied(false), 1500);
          } else pushToast('error', tc('copy_failed'));
        }}
        aria-label={t('preview_copy_install')}
        title={t('preview_copy_install')}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-600 transition hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

export function SkillPreview({ data }: { data: EmbedSkillData }) {
  const t = useTranslations('zones');
  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{data.name}</h2>
          <span className="rounded-full border border-zinc-300 px-2 py-px font-mono text-[11px] text-muted dark:border-zinc-700">
            {t(`embed_source_${data.sourceType}`)}
          </span>
        </div>
        {data.summary && <p className="mt-1.5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{data.summary}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
        <Link href={`/users/${data.author.handle}`} className="inline-flex items-center gap-1.5 hover:underline">
          <Avatar name={data.author.displayName} src={data.author.avatarUrl} size="xs" />
          <span className="text-zinc-800 dark:text-zinc-200">{data.author.displayName}</span>
        </Link>
        <span className="font-mono tabular-nums">{t('embed_meta_downloads', { count: fmtCount(data.downloads) })}</span>
        <span className="font-mono tabular-nums">♡ {fmtCount(data.likes)}</span>
        {data.rating > 0 && <span className="font-mono tabular-nums">★ {data.rating.toFixed(1)}</span>}
      </div>

      <InstallSnippet cmd={data.installCmd} />

      <Link
        href={data.href}
        className="inline-flex h-9 items-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {t('preview_open_skill')}
      </Link>
    </div>
  );
}
