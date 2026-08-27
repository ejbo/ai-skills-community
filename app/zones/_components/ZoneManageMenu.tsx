'use client';

// 技术专区 — 管理 dropdown in the zone header (settings / members / roles /
// danger). Renders null when the viewer holds none of those permissions.
//
// The panel is PORTALED to <body> and positioned from the trigger's
// getBoundingClientRect() — see `useAnchoredPanel`, which owns the placement,
// the outside-click test across two detached nodes, the scroll/resize
// re-measure and the flip-up. It has to be portaled: the header <section> that
// hosts the trigger is `relative overflow-hidden` (cover image + HairlineGrid),
// so an absolutely positioned menu is CLIPPED by that ancestor no matter how
// high its z-index is.
//
// What stays here is what portaling costs THIS menu specifically: it leaves the
// natural tab order, so focus is managed explicitly per the ARIA menu-button
// pattern — opening focuses the first item, ↑/↓/Home/End roam, Escape and Tab
// hand focus back to the trigger.

import { useEffect, useId, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, ChevronDown, Settings, ShieldCheck, Users } from 'lucide-react';
import { zoneHref } from '@/lib/zones/shared';
import type { ZoneAccess } from '@/lib/zones/types';
import { BTN_SECONDARY } from './ui';
import { useAnchoredPanel } from '@/components/useAnchoredPanel';

/** w-56, in px — the estimate used for the very first paint, refined after measuring. */
const MENU_W = 224;
const ITEM_H = 40;

interface MenuItem {
  key: string;
  href: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}

export function ZoneManageMenu({
  slug,
  access,
  pendingCount = 0,
}: {
  slug: string;
  access: ZoneAccess;
  pendingCount?: number;
}) {
  const t = useTranslations('zones');
  const reduce = useReducedMotion();
  const menuId = useId();
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  const items = useMemo<MenuItem[]>(() => {
    const base = zoneHref(slug);
    const list: MenuItem[] = [];
    if (access.canManage) {
      list.push({ key: 'settings', href: `${base}/settings`, icon: <Settings className="h-4 w-4" />, label: t('manage_settings') });
    }
    if (access.canManageMembers) {
      list.push({
        key: 'members',
        href: `${base}/members${pendingCount > 0 ? '?tab=pending' : ''}`,
        icon: <Users className="h-4 w-4" />,
        label: t('manage_members'),
        badge: pendingCount,
      });
    }
    if (access.canManageRoles) {
      list.push({ key: 'roles', href: `${base}/settings?tab=roles`, icon: <ShieldCheck className="h-4 w-4" />, label: t('manage_roles') });
    }
    if (access.isOwner || access.siteAdmin) {
      list.push({ key: 'danger', href: `${base}/settings?tab=danger`, icon: <AlertTriangle className="h-4 w-4" />, label: t('manage_danger') });
    }
    return list;
  }, [access.canManage, access.canManageMembers, access.canManageRoles, access.isOwner, access.siteAdmin, pendingCount, slug, t]);

  const hintShown = access.siteAdmin && !access.isMember;
  // First-paint estimate; the hook's layout pass replaces it with the real box.
  const estimatedH = items.length * ITEM_H + (hintShown ? 34 : 0) + 8;

  const { open, openPanel, close, pos, triggerRef, panelRef, host, place } = useAnchoredPanel<HTMLButtonElement>({
    width: MENU_W,
    height: estimatedH,
  });

  // Drop refs left by a shorter/longer previous list.
  useEffect(() => {
    itemRefs.current.length = items.length;
  }, [items.length]);

  // Portaling drops the panel out of the tab order, so opening moves focus into
  // it explicitly (ARIA menu-button pattern).
  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => itemRefs.current[0]?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const els = itemRefs.current.filter(Boolean) as HTMLAnchorElement[];
    if (els.length === 0) return;
    const i = els.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      els[(i <= 0 ? els.length : i) - 1]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      els[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      els[els.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') {
      // No preventDefault: focus goes back to the trigger synchronously, so the
      // browser then continues tabbing from there — natural order is preserved.
      close(true);
    }
  }

  function onTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) openPanel();
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      close(true);
    }
  }

  if (items.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (open) close();
          else openPanel();
        }}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={BTN_SECONDARY}
      >
        <Settings className="h-4 w-4" />
        {t('manage_menu')}
        {pendingCount > 0 && (
          <span className="ml-0.5 rounded-full bg-zinc-900 px-1.5 font-mono text-[10px] tabular-nums text-white dark:bg-zinc-50 dark:text-zinc-900">
            {pendingCount}
          </span>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 text-zinc-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {host &&
        createPortal(
          <AnimatePresence>
            {open && pos && (
              <motion.div
                ref={panelRef}
                id={menuId}
                role="menu"
                aria-label={t('manage_menu')}
                tabIndex={-1}
                onKeyDown={onMenuKeyDown}
                onAnimationComplete={place}
                initial={{ opacity: 0, y: reduce ? 0 : pos.up ? 4 : -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduce ? 0 : pos.up ? 4 : -4 }}
                transition={{ duration: 0.15 }}
                // z-[70]: above the sticky NavBar (z-40), below every dialog
                // (z-[80]+) and the zones PreviewDrawer (z-[90]/z-[95]).
                className="surface fixed z-[70] w-56 overflow-y-auto overscroll-contain rounded-xl p-1 shadow-lg"
                style={{ left: pos.left, top: pos.top, maxHeight: pos.maxHeight }}
              >
                {hintShown && <div className="px-3 py-2 text-xs text-muted">{t('manage_site_admin_hint')}</div>}
                {items.map((it, idx) => (
                  <Link
                    key={it.key}
                    ref={(el) => {
                      itemRefs.current[idx] = el;
                    }}
                    href={it.href}
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => close()}
                    // outline-none + an INSET ring: the global focus outline has
                    // `outline-offset: 2px`, which an overflow-y-auto panel clips.
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-700 outline-none transition hover:bg-zinc-100 focus-visible:bg-zinc-100 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zinc-400 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:focus-visible:bg-zinc-800 dark:focus-visible:ring-zinc-500"
                  >
                    <span className="text-zinc-500">{it.icon}</span>
                    <span className="flex-1">{it.label}</span>
                    {it.badge ? (
                      <span className="rounded-full border border-zinc-300 px-1.5 font-mono text-[10px] tabular-nums text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                        {it.badge}
                      </span>
                    ) : null}
                  </Link>
                ))}
              </motion.div>
            )}
          </AnimatePresence>,
          host,
        )}
    </>
  );
}
