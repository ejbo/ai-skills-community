'use client';

// 用户卡片 — wrap any name/avatar and it gains a hover card.
//
// One fetch per user per page (module-level cache), fired on hover INTENT
// (150 ms) rather than on every pass of the pointer, so a list of forty
// annotators does not become forty requests when you sweep across it. Touch
// devices get the same card on tap-and-hold via focus.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { withBasePath } from '@/lib/base-path';
import { tagColorClass } from '@/lib/user-tags';

export interface UserCardData {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  signature: string;
  department: string | null;
  lab: string | null;
  isPrivate: boolean;
  roleName: string | null;
  tags: { key: string; name: string; color: string; kind: string }[];
  stats: { skills: number; docs: number };
}

/** Shared across every card on the page — the same person is fetched once. */
const cache = new Map<string, UserCardData | null>();
const inflight = new Map<string, Promise<UserCardData | null>>();

async function loadCard(handle: string): Promise<UserCardData | null> {
  if (cache.has(handle)) return cache.get(handle) ?? null;
  const existing = inflight.get(handle);
  if (existing) return existing;
  const p = (async () => {
    try {
      const res = await fetch(withBasePath(`/api/users/${encodeURIComponent(handle)}/card`));
      const data = res.ok ? ((await res.json()) as UserCardData) : null;
      cache.set(handle, data);
      return data;
    } catch {
      cache.set(handle, null);
      return null;
    } finally {
      inflight.delete(handle);
    }
  })();
  inflight.set(handle, p);
  return p;
}

const OPEN_DELAY = 150;
const CLOSE_DELAY = 200;

export function UserHoverCard({
  handle,
  children,
  className,
}: {
  handle: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState<UserCardData | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const id = useId();

  const clearTimers = () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  };

  useEffect(() => clearTimers, []);

  const show = useCallback(() => {
    clearTimers();
    openTimer.current = window.setTimeout(() => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Flip above when the card would fall off the bottom.
      const above = r.bottom + 260 > window.innerHeight && r.top > 260;
      setPos({
        top: above ? r.top - 8 : r.bottom + 8,
        left: Math.min(Math.max(r.left, 12), window.innerWidth - 300),
        above,
      });
      setOpen(true);
      void loadCard(handle).then(setCard);
    }, OPEN_DELAY);
  }, [handle]);

  const hide = useCallback(() => {
    clearTimers();
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY);
  }, []);

  return (
    <>
      <span
        ref={anchorRef}
        className={className}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-describedby={open ? id : undefined}
      >
        {children}
      </span>
      {open && pos && (
        <div
          id={id}
          role="tooltip"
          onMouseEnter={clearTimers}
          onMouseLeave={hide}
          style={{ top: pos.top, left: pos.left }}
          className={`surface fixed z-[70] w-72 overflow-hidden rounded-xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10 ${
            pos.above ? '-translate-y-full' : ''
          }`}
        >
          <CardBody card={card} handle={handle} />
        </div>
      )}
    </>
  );
}

function CardBody({ card, handle }: { card: UserCardData | null; handle: string }) {
  const t = useTranslations('profile');
  if (!card) {
    return (
      <div className="space-y-2 p-3">
        <div className="shimmer h-12 w-full rounded-lg" />
        <div className="shimmer h-3 w-24 rounded" />
        <div className="shimmer h-3 w-40 rounded" />
      </div>
    );
  }
  return (
    <div>
      {/* 背景 — a plain tint when the member has not set one. */}
      <div
        className="h-14 w-full bg-gradient-to-br from-zinc-900/25 to-zinc-900/5 bg-cover bg-center"
        style={card.bannerUrl ? { backgroundImage: `url(${withBasePath(card.bannerUrl)})` } : undefined}
      />
      <div className="px-3 pb-3">
        <div className="-mt-6 flex items-end gap-2">
          <span className="rounded-full ring-2 ring-[rgb(var(--surface))]">
            <Avatar name={card.displayName} src={card.avatarUrl} size="lg" />
          </span>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <Link
            href={`/users/${card.handle}`}
            className="min-w-0 truncate text-sm font-semibold hover:text-zinc-900"
          >
            {card.displayName}
          </Link>
          {card.roleName && (
            <span className="shrink-0 rounded bg-zinc-900/[0.06] dark:bg-white/10 px-1 py-px text-[10px] font-medium text-zinc-900 dark:text-zinc-50">
              {card.roleName}
            </span>
          )}
        </div>
        {!card.isPrivate && <p className="text-[11px] text-muted">@{handle}</p>}
        <DeptTag department={card.department} lab={card.lab} />

        {card.signature && (
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">{card.signature}</p>
        )}

        {card.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {card.tags.map((tag) => (
              <span
                key={tag.key}
                className={`rounded px-1.5 py-px text-[10px] font-medium ${tagColorClass(tag.color)}`}
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}

        <div className="mt-2 flex items-center gap-3 font-mono text-[11px] tabular-nums text-muted">
          <span>{t('n_skills', { count: card.stats.skills })}</span>
          <span>{t('n_docs', { count: card.stats.docs })}</span>
        </div>
      </div>
    </div>
  );
}
