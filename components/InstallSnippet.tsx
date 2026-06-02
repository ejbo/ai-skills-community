'use client';

import { Check, Copy } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { pushToast } from './Toaster';
import { copyText } from '@/lib/clipboard';

export function InstallSnippet({ slug, version }: { slug: string; version?: string }) {
  const t = useTranslations('common');
  const [copied, setCopied] = useState(false);
  // The CLI is served as a tarball from this same server, so the install command
  // tracks whatever host the site is on (AWS now, intranet later) with no edits.
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  const ref = version ? `${slug}@${version}` : slug;
  const cmd = `npx ${origin}/skills-cli.tgz install ${ref}`;
  // Until the origin is known (pre-hydration / SSR) show a neutral host
  // placeholder instead of a malformed "npx /skills-cli.tgz …".
  const display = `npx ${origin || '…'}/skills-cli.tgz install ${ref}`;

  async function copy() {
    if (!origin) return;
    if (await copyText(cmd)) {
      setCopied(true);
      pushToast('success', t('copied_hint'));
      setTimeout(() => setCopied(false), 1800);
    } else {
      pushToast('error', t('copy_failed'));
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="surface flex items-center gap-3 rounded-xl p-1 pl-4 shadow-[inset_0_0_0_1px_rgba(94,90,255,0.18)]">
        <span className="font-mono text-zinc-400 select-none">$</span>
        <code className="flex-1 truncate font-mono text-sm text-zinc-800 dark:text-zinc-100">
          {display}
        </code>
        <button
          onClick={copy}
          aria-label={copied ? t('copied') : t('copy')}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-3 text-sm font-medium text-white transition hover:bg-accent-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-950"
        >
          <AnimatePresence mode="wait" initial={false}>
            {copied ? (
              <motion.span
                key="check"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: [1, 1.25, 1], opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ duration: 0.6, times: [0, 0.4, 1] }}
                className="flex items-center gap-1.5"
              >
                <Check className="h-3.5 w-3.5" />
                {t('copied')}
              </motion.span>
            ) : (
              <motion.span
                key="copy"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-1.5"
              >
                <Copy className="h-3.5 w-3.5" />
                {t('copy')}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
      <p className="text-[11px] text-muted">
        首次使用需先登录：<code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">skills login</code>
        （在 <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">/settings/tokens</code> 创建 token）。
      </p>
    </div>
  );
}
