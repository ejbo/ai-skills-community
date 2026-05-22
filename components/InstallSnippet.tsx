'use client';

import { Check, Copy } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { pushToast } from './Toaster';

export function InstallSnippet({ slug, version }: { slug: string; version?: string }) {
  const [copied, setCopied] = useState(false);
  const cmd = version
    ? `npx @skills-community/cli install ${slug}@${version}`
    : `npx @skills-community/cli install ${slug}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      pushToast('success', 'Copied — paste in your terminal');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      pushToast('error', 'Copy failed');
    }
  }

  return (
    <div className="surface flex items-center gap-3 rounded-xl p-1 pl-4 shadow-[inset_0_0_0_1px_rgba(94,90,255,0.18)]">
      <span className="font-mono text-zinc-400 select-none">$</span>
      <code className="flex-1 truncate font-mono text-sm text-zinc-800 dark:text-zinc-100">
        {cmd}
      </code>
      <button
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy install command'}
        className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-3 text-sm font-medium text-white transition hover:bg-accent-600"
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
              Copied
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
              Copy
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    </div>
  );
}
