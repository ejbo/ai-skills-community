'use client';

import { useState, useTransition } from 'react';
import { Plus, Trash2, Copy, Check, Loader2, Key } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { pushToast } from '@/components/Toaster';

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
  const [tokens, setTokens] = useState(initialTokens);
  const [newName, setNewName] = useState('');
  const [creating, startCreate] = useTransition();
  const [revoking, startRevoke] = useTransition();
  const [newlyCreated, setNewlyCreated] = useState<{ id: string; raw: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function create() {
    if (!newName.trim()) {
      pushToast('error', '给 token 起个名字（比如 laptop）');
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
        pushToast('error', data.error ?? '创建失败');
        return;
      }
      const t = data.token as Token & { raw: string };
      setTokens((arr) => [
        {
          id: t.id,
          name: t.name,
          tokenPrefix: t.tokenPrefix,
          scopes: t.scopes,
          lastUsedAt: null,
          expiresAt: null,
          createdAt: t.createdAt,
        },
        ...arr,
      ]);
      setNewlyCreated({ id: t.id, raw: t.raw });
      setNewName('');
    });
  }

  function revoke(id: string) {
    if (!confirm('确定吊销这个 token？此后用它的 CLI 会话都会失效。')) return;
    startRevoke(async () => {
      const res = await fetch(`/api/auth/cli-token/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', '吊销失败');
        return;
      }
      setTokens((arr) => arr.filter((t) => t.id !== id));
      pushToast('success', '已吊销');
    });
  }

  async function copyRaw() {
    if (!newlyCreated) return;
    await navigator.clipboard.writeText(newlyCreated.raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
    pushToast('success', '已复制 — 请保存到 ~/.skills/config.json');
  }

  return (
    <div className="space-y-4">
      <div className="surface flex items-center gap-2 rounded-2xl p-3">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="新 token 名称（如 laptop、ci-server）"
          className="h-9 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <button
          onClick={create}
          disabled={creating}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          生成
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
            <div className="mb-2 text-sm font-semibold text-warn">⚠ 立即复制 — 此 token 只显示一次</div>
            <div className="flex items-center gap-2 rounded-lg bg-white p-2 dark:bg-zinc-950">
              <code className="flex-1 truncate font-mono text-xs">{newlyCreated.raw}</code>
              <button
                onClick={copyRaw}
                className="flex h-7 items-center gap-1 rounded-md bg-accent-500 px-2 text-xs text-white transition hover:bg-accent-600"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? '已复制' : '复制'}
              </button>
            </div>
            <button
              onClick={() => setNewlyCreated(null)}
              className="mt-2 text-xs text-muted hover:text-zinc-900 dark:hover:text-white"
            >
              我已保存，关闭这条提示
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {tokens.length === 0 ? (
        <div className="surface flex flex-col items-center rounded-2xl px-6 py-10 text-center">
          <Key className="h-6 w-6 text-muted" />
          <p className="mt-2 text-sm text-muted">还没有任何 CLI Token。</p>
        </div>
      ) : (
        <ul className="surface divide-y divide-zinc-100 overflow-hidden rounded-2xl dark:divide-zinc-800">
          {tokens.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Key className="h-3.5 w-3.5 text-muted" />
                  <span className="font-medium">{t.name}</span>
                  <code className="font-mono text-[11px] text-muted">{t.tokenPrefix}…</code>
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  范围: {t.scopes.join(', ')} · 创建于 {format(new Date(t.createdAt), 'yyyy-MM-dd')}
                  {t.lastUsedAt && ` · 最近 ${formatDistanceToNowStrict(new Date(t.lastUsedAt), { addSuffix: true })}`}
                </div>
              </div>
              <button
                onClick={() => revoke(t.id)}
                disabled={revoking}
                className="flex h-7 items-center gap-1 rounded-md border border-danger/40 px-2 text-xs text-danger transition hover:bg-danger/10 disabled:opacity-60"
              >
                <Trash2 className="h-3 w-3" />
                吊销
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
