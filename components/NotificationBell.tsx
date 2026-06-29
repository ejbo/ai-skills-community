'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, CheckCheck } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { useTranslations } from 'next-intl';
import { withBasePath } from '@/lib/base-path';

interface Notif {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
  actor: { displayName: string; avatarUrl: string | null } | null;
}

export function NotificationBell() {
  const t = useTranslations('notifications');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications ?? []);
      setUnread(data.unreadCount ?? 0);
    } catch {
      /* offline / transient — keep last known state */
    }
  }, []);

  // Initial load + light polling so the badge stays roughly fresh.
  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  function toggle() {
    setOpen((o) => {
      const next = !o;
      if (next) load();
      return next;
    });
  }

  async function onItemClick(n: Notif) {
    if (!n.read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      try {
        await fetch('/api/notifications/read', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: n.id }),
        });
      } catch {
        /* best-effort */
      }
    }
    // Open the related place in a NEW tab (deep-linked to the comment/skill/announcement).
    if (n.link) window.open(withBasePath(n.link), '_blank', 'noopener');
    setOpen(false);
  }

  async function markAll() {
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnread(0);
    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      /* best-effort */
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        aria-label={t('title')}
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="surface absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl p-1 shadow-lg"
          >
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-sm font-semibold">{t('title')}</span>
              {unread > 0 && (
                <button
                  onClick={markAll}
                  className="inline-flex items-center gap-1 text-xs text-muted transition hover:text-accent-600"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  {t('mark_all_read')}
                </button>
              )}
            </div>

            <div className="max-h-[60vh] overflow-auto">
              {items.length === 0 ? (
                <div className="px-3 py-10 text-center text-sm text-muted">{t('empty')}</div>
              ) : (
                items.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => onItemClick(n)}
                    className={`flex w-full gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                      n.read ? '' : 'bg-accent-500/5'
                    }`}
                  >
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-accent-500'}`}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-snug">{n.title}</span>
                      {n.body && <span className="mt-0.5 block truncate text-xs text-muted">{n.body}</span>}
                      <span className="mt-0.5 block text-[11px] text-muted">
                        {formatDistanceToNowStrict(new Date(n.createdAt), { addSuffix: true })}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
