'use client';

// 技术专区 — 管理 dropdown in the zone header (settings / members / roles /
// danger). Renders null when the viewer holds none of those permissions.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ChevronDown, Settings, ShieldCheck, Users } from 'lucide-react';
import { zoneHref } from '@/lib/zones/shared';
import type { ZoneAccess } from '@/lib/zones/types';
import { BTN_SECONDARY } from './ui';

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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  const base = zoneHref(slug);
  const items: { key: string; href: string; icon: React.ReactNode; label: string; badge?: number }[] = [];
  if (access.canManage) {
    items.push({ key: 'settings', href: `${base}/settings`, icon: <Settings className="h-4 w-4" />, label: t('manage_settings') });
  }
  if (access.canManageMembers) {
    items.push({
      key: 'members',
      href: `${base}/members${pendingCount > 0 ? '?tab=pending' : ''}`,
      icon: <Users className="h-4 w-4" />,
      label: t('manage_members'),
      badge: pendingCount,
    });
  }
  if (access.canManageRoles) {
    items.push({ key: 'roles', href: `${base}/settings?tab=roles`, icon: <ShieldCheck className="h-4 w-4" />, label: t('manage_roles') });
  }
  if (access.isOwner || access.siteAdmin) {
    items.push({ key: 'danger', href: `${base}/settings?tab=danger`, icon: <AlertTriangle className="h-4 w-4" />, label: t('manage_danger') });
  }
  if (items.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={BTN_SECONDARY}
      >
        <Settings className="h-4 w-4" />
        {t('manage_menu')}
        {pendingCount > 0 && (
          <span className="ml-0.5 rounded-full bg-zinc-900 px-1.5 font-mono text-[10px] tabular-nums text-white dark:bg-zinc-50 dark:text-zinc-900">
            {pendingCount}
          </span>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="surface absolute right-0 top-full z-30 mt-2 w-56 rounded-xl p-1 shadow-lg"
          >
            {access.siteAdmin && !access.isMember && (
              <div className="px-3 py-2 text-xs text-muted">{t('manage_site_admin_hint')}</div>
            )}
            {items.map((it) => (
              <Link
                key={it.key}
                href={it.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
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
      </AnimatePresence>
    </div>
  );
}
