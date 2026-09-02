'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, CheckCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { relativeTime } from '@/lib/i18n-date';
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

const POLL_MS = 60_000;

/**
 * Floor on how often coming back to a tab may fire a catch-up load, so alt-tabbing
 * doesn't become one request per switch. Well under POLL_MS, so a tab someone is
 * actually using never notices it.
 */
const CATCHUP_MIN_GAP_MS = 10_000;

/**
 * Hover-to-read (owner ask: 「鼠标hover过里面的通知，就可以当作read过」).
 *
 * The dwell is the whole design. Marking on `pointerenter` would clear the
 * entire list the moment someone sweeps the pointer down it on the way to the
 * scrollbar — the feature would silently destroy the thing it is supposed to
 * help with, and there is no undo. Half a second is long enough that the
 * pointer has *settled* on a row (i.e. you are reading it) and short enough
 * that reading a row never fails to clear it.
 */
const HOVER_DWELL_MS = 500;

/**
 * Dwells are coalesced into ONE request: the flush is DEBOUNCED from the last
 * mark, so reading three rows in a row is one POST rather than three. It has to
 * be longer than the dwell itself — with a window shorter than HOVER_DWELL_MS
 * the next row can never land inside it and the "batch" is always one id, which
 * is exactly what the first cut did.
 */
const FLUSH_DELAY_MS = 1200;

/**
 * ...but a debounce alone can be starved: someone slowly reading twelve rows
 * would keep pushing the send out. Nothing waits longer than this after the
 * FIRST queued mark. (Closing the panel, hiding the tab and unmounting all
 * flush immediately, so this is a backstop, not the usual path.)
 */
const MAX_COALESCE_MS = 3_000;

/** Matches the server's cap on `{ ids }` (app/api/notifications/read). */
const MAX_BATCH = 100;

/**
 * `:focus-visible` is how "the keyboard is driving" is spelled. Tabbing THROUGH
 * the list must not clear it (that is the sweep problem again), so keyboard
 * focus gets the same dwell as hover: pause on a row and it is read, blow past
 * it and it is not. Guarded because a non-supporting engine throws on the
 * selector rather than returning false.
 */
function isKeyboardFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

export function NotificationBell() {
  const t = useTranslations('notifications');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const lastLoadRef = useRef(0);

  // Ids this client has already painted as read — never queued twice, and
  // re-applied over every poll response so a load landing between the
  // optimistic paint and the flush cannot make a row blink back to unread.
  const markedRef = useRef<Set<string>>(new Set());
  // Marked but not yet sent. The next flush carries them; a load subtracts them
  // from the server's (still stale) unread count.
  const pendingRef = useRef<Set<string>>(new Set());
  const dwellRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queuedAtRef = useRef(0);

  const load = useCallback(async () => {
    lastLoadRef.current = Date.now();
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return;
      const data = await res.json();
      const list: Notif[] = data.notifications ?? [];
      setItems(list.map((n) => (markedRef.current.has(n.id) ? { ...n, read: true } : n)));
      setUnread(Math.max(0, (data.unreadCount ?? 0) - pendingRef.current.size));
    } catch {
      /* offline / transient — keep last known state */
    }
  }, []);

  /** Send everything queued, then reconcile the badge with the server's count. */
  const flush = useCallback(async () => {
    if (flushRef.current !== null) {
      clearTimeout(flushRef.current);
      flushRef.current = null;
    }
    const ids = [...pendingRef.current];
    if (ids.length === 0) return;
    pendingRef.current.clear();
    queuedAtRef.current = 0;
    try {
      const res = await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
        // The panel usually closes (or the tab hides) right after the last
        // dwell — keepalive is what lets that final flush actually leave.
        keepalive: true,
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (typeof data?.unreadCount === 'number') setUnread(data.unreadCount);
    } catch {
      // Roll the optimistic paint back rather than lying: these are unread
      // again, and hovering them once more will retry.
      const failed = new Set(ids);
      for (const id of ids) markedRef.current.delete(id);
      setItems((prev) => prev.map((x) => (failed.has(x.id) ? { ...x, read: false } : x)));
      setUnread((u) => u + ids.length);
    }
  }, []);

  /** Optimistic paint + queue. `now` skips the coalescing window (click path). */
  const markRead = useCallback(
    (ids: string[], now = false) => {
      const fresh = ids.filter((id) => !markedRef.current.has(id));
      if (fresh.length === 0) return;
      if (pendingRef.current.size === 0) queuedAtRef.current = Date.now();
      for (const id of fresh) {
        markedRef.current.add(id);
        pendingRef.current.add(id);
      }
      const added = new Set(fresh);
      setItems((prev) => prev.map((x) => (added.has(x.id) ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - fresh.length));

      const starved = Date.now() - queuedAtRef.current >= MAX_COALESCE_MS;
      if (now || starved || pendingRef.current.size >= MAX_BATCH) {
        void flush();
        return;
      }
      if (flushRef.current !== null) clearTimeout(flushRef.current);
      flushRef.current = setTimeout(() => void flush(), FLUSH_DELAY_MS);
    },
    [flush],
  );

  const cancelDwell = useCallback((id?: string) => {
    const d = dwellRef.current;
    if (!d) return;
    if (id !== undefined && d.id !== id) return;
    clearTimeout(d.timer);
    dwellRef.current = null;
  }, []);

  const startDwell = useCallback(
    (n: Notif) => {
      if (n.read) return;
      cancelDwell();
      dwellRef.current = {
        id: n.id,
        timer: setTimeout(() => {
          dwellRef.current = null;
          markRead([n.id]);
        }, HOVER_DWELL_MS),
      };
    },
    [cancelDwell, markRead],
  );

  // Initial load + light polling so the badge stays roughly fresh — but the poll runs
  // ONLY while the tab is visible. A hidden tab makes no other requests, so its poll is
  // pure background load on the single Node thread, and it is the one that scales with
  // tabs-per-user. Nothing else rides on the cadence: the 活动提醒 sweep this endpoint
  // piggybacks is throttled per PROCESS (once a minute, whoever polls) and cron
  // (scripts/send-event-reminders.ts) is its belt-and-braces path, so a browser full of
  // hidden tabs no longer buys anything by polling.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(load, POLL_MS);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        stop();
        // Leaving with unsent marks would lose them until the next dwell —
        // keepalive makes this send survive the tab going away.
        cancelDwell();
        void flush();
        return;
      }
      // Back in view: catch up once (the badge is the first thing the user looks at),
      // then restart the interval from now rather than resuming a stale phase.
      if (Date.now() - lastLoadRef.current >= CATCHUP_MIN_GAP_MS) load();
      start();
    };
    load();
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load, flush, cancelDwell]);

  // Unmount (navigation away): never sit on marks the user has already seen fade.
  useEffect(
    () => () => {
      cancelDwell();
      void flush();
    },
    [cancelDwell, flush],
  );

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  // Closing the panel ends every dwell and sends what is queued.
  useEffect(() => {
    if (open) return;
    cancelDwell();
    void flush();
  }, [open, cancelDwell, flush]);

  function toggle() {
    setOpen((o) => {
      const next = !o;
      if (next) load();
      return next;
    });
  }

  function onItemClick(n: Notif) {
    cancelDwell(n.id);
    if (!n.read) markRead([n.id], true);
    // Open the related place in a NEW tab (deep-linked to the comment/skill/announcement).
    if (n.link) window.open(withBasePath(n.link), '_blank', 'noopener');
    setOpen(false);
  }

  async function markAll() {
    cancelDwell();
    if (flushRef.current !== null) {
      clearTimeout(flushRef.current);
      flushRef.current = null;
    }
    // `all` covers everything queued, so the batch has nothing left to say.
    pendingRef.current.clear();
    queuedAtRef.current = 0;
    for (const x of items) markedRef.current.add(x.id);
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnread(0);
    try {
      const res = await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && typeof data?.unreadCount === 'number') setUnread(data.unreadCount);
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
            // The PANEL is what's bounded (not just the list inside it): the header
            // stays pinned and the items scroll within a fixed-height card instead of
            // the popover growing down the page with 20 unread notifications.
            className="surface absolute right-0 top-full mt-2 flex max-h-[min(70vh,28rem)] w-80 max-w-[calc(100vw-2rem)] flex-col rounded-xl p-1 shadow-lg"
          >
            <div className="flex shrink-0 items-center justify-between px-3 py-2">
              <span className="text-sm font-semibold">{t('title')}</span>
              {unread > 0 && (
                <button
                  onClick={markAll}
                  className="inline-flex items-center gap-1 text-xs text-muted transition hover:text-zinc-900 dark:hover:text-zinc-50"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  {t('mark_all_read')}
                </button>
              )}
            </div>

            {/* overscroll-contain: without it, hitting the end of the list chained the
                wheel to the page — which also slid the auto-hiding navbar away. */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
              {items.length === 0 ? (
                <div className="px-3 py-10 text-center text-sm text-muted">{t('empty')}</div>
              ) : (
                items.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => onItemClick(n)}
                    // pointerenter/leave rather than mouseenter: `pointerType`
                    // tells a real hover from the phantom one a tap emits, so
                    // touch keeps the click path and never auto-reads a row.
                    onPointerEnter={(e) => {
                      if (e.pointerType === 'touch') return;
                      startDwell(n);
                    }}
                    onPointerLeave={() => cancelDwell(n.id)}
                    onFocus={(e) => {
                      if (isKeyboardFocus(e.currentTarget)) startDwell(n);
                    }}
                    onBlur={() => cancelDwell(n.id)}
                    className={`flex w-full gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-zinc-100 motion-reduce:transition-none dark:hover:bg-zinc-800 ${
                      n.read ? '' : 'bg-zinc-100/70 dark:bg-white/[0.04]'
                    }`}
                  >
                    {/* The dot FADES as the dwell lands: hover-to-read is otherwise
                        an invisible mechanic, and this is the only feedback that it
                        happened. Duration is a fade, not a move — nothing reflows. */}
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full bg-danger transition-opacity duration-300 motion-reduce:transition-none ${
                        n.read ? 'opacity-0' : 'opacity-100'
                      }`}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      {!n.read && <span className="sr-only">{t('unread')} </span>}
                      <span className="block text-sm font-medium leading-snug">{n.title}</span>
                      {n.body && <span className="mt-0.5 block truncate text-xs text-muted">{n.body}</span>}
                      <span className="mt-0.5 block text-[11px] text-muted">
                        {relativeTime(n.createdAt, locale)}
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
