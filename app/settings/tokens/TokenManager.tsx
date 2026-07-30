'use client';

import { useState, useTransition } from 'react';
import { Plus, Trash2, Copy, Check, Loader2, Key } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { useLocale, useTranslations } from 'next-intl';
import { relativeTime } from '@/lib/i18n-date';
import { pushToast } from '@/components/Toaster';
import { copyText } from '@/lib/clipboard';

interface Token {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export function TokenManager({ initialTokens }: { initialTokens: Token[] }) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [tokens, setTokens] = useState(initialTokens);
  const [newName, setNewName] = useState('');
  const [creating, startCreate] = useTransition();
  const [revoking, startRevoke] = useTransition();
  const [newlyCreated, setNewlyCreated] = useState<{ id: string; raw: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function create() {
    if (!newName.trim()) {
      pushToast('error', t('token_name_required'));
      return;
    }
    startCreate(async () => {
      const res = await fetch('/api/auth/cli-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), scopes: ['read', 'publish'] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data.error ?? t('token_create_failed'));
        return;
      }
      const created = data.token as Token & { raw: string };
      setTokens((arr) => [
        {
          id: created.id,
          name: created.name,
          tokenPrefix: created.tokenPrefix,
          scopes: created.scopes,
          lastUsedAt: null,
          expiresAt: null,
          createdAt: created.createdAt,
        },
        ...arr,
      ]);
      setNewlyCreated({ id: created.id, raw: created.raw });
      setNewName('');
    });
  }

  function revoke(id: string) {
    if (!confirm(t('token_revoke_confirm'))) return;
    startRevoke(async () => {
      const res = await fetch(`/api/auth/cli-token/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', t('token_revoke_failed'));
        return;
      }
      setTokens((arr) => arr.filter((tk) => tk.id !== id));
      pushToast('success', t('token_revoked'));
    });
  }

  async function copyRaw() {
    if (!newlyCreated) return;
    if (await copyText(newlyCreated.raw)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      pushToast('success', t('token_copied_hint'));
    } else {
      pushToast('error', t('token_copy_failed_manual'));
    }
  }

  return (
    <div className="space-y-4">
      <div className="surface flex items-center gap-2 rounded-2xl p-3">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t('token_name_placeholder')}
          className="h-9 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <button
          onClick={create}
          disabled={creating}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          {t('token_generate')}
        </button>
      </div>

      <AnimatePresence>
        {newlyCreated && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-2xl border border-warn/40 bg-warn/10 p-4"
          >
            <div className="mb-2 text-sm font-semibold text-warn">{t('token_copy_now_once')}</div>
            <div className="flex items-center gap-2 rounded-lg bg-white p-2 dark:bg-zinc-950">
              <code className="flex-1 truncate font-mono text-xs">{newlyCreated.raw}</code>
              <button
                onClick={copyRaw}
                className="flex h-7 items-center gap-1 rounded-md bg-accent-500 px-2 text-xs text-white transition hover:bg-accent-600"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? tc('copied') : tc('copy')}
              </button>
            </div>
            <button
              onClick={() => setNewlyCreated(null)}
              className="mt-2 text-xs text-muted hover:text-zinc-900 dark:hover:text-white"
            >
              {t('token_saved_dismiss')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {tokens.length === 0 ? (
        <div className="surface flex flex-col items-center rounded-2xl px-6 py-10 text-center">
          <Key className="h-6 w-6 text-muted" />
          <p className="mt-2 text-sm text-muted">{t('token_empty')}</p>
        </div>
      ) : (
        <ul className="surface divide-y divide-zinc-100 overflow-hidden rounded-2xl dark:divide-zinc-800">
          {tokens.map((tk) => (
            <li key={tk.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Key className="h-3.5 w-3.5 text-muted" />
                  <span className="font-medium">{tk.name}</span>
                  <code className="font-mono text-[11px] text-muted">{tk.tokenPrefix}…</code>
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {t('token_meta', {
                    scopes: tk.scopes.join(', '),
                    date: format(new Date(tk.createdAt), 'yyyy-MM-dd'),
                  })}
                  {tk.lastUsedAt &&
                    ` · ${t('token_last_used', { time: relativeTime(tk.lastUsedAt, locale) })}`}
                </div>
              </div>
              <button
                onClick={() => revoke(tk.id)}
                disabled={revoking}
                className="flex h-7 items-center gap-1 rounded-md border border-danger/40 px-2 text-xs text-danger transition hover:bg-danger/10 disabled:opacity-60"
              >
                <Trash2 className="h-3 w-3" />
                {t('token_revoke')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
