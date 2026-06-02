'use client';

import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, LayoutDashboard, ShieldCheck, Upload, LogOut, User } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { useTranslations } from 'next-intl';

interface MenuUser {
  id: string;
  email: string;
  displayName?: string;
  handle?: string;
  isAdmin?: boolean;
  image?: string | null;
}

export function UserMenu({ user }: { user: MenuUser }) {
  const t = useTranslations('nav');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const initial = (user.displayName ?? user.email ?? 'U').charAt(0).toUpperCase();
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={user.displayName ?? user.email}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-zinc-800"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-500 text-xs font-semibold text-white">
          {initial}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="surface absolute right-0 top-full mt-2 w-56 rounded-xl p-1 shadow-lg"
          >
            <div className="px-3 py-2 text-xs text-muted">{user.email}</div>
            <MenuItem href={`/users/${user.handle ?? user.id}`} icon={<User className="h-4 w-4" />}>
              {t('profile')}
            </MenuItem>
            <MenuItem href="/dashboard" icon={<LayoutDashboard className="h-4 w-4" />}>
              {t('dashboard')}
            </MenuItem>
            <MenuItem href="/skills/new" icon={<Upload className="h-4 w-4" />}>
              {t('upload')}
            </MenuItem>
            {user.isAdmin && (
              <MenuItem href="/manage" icon={<ShieldCheck className="h-4 w-4" />}>
                {t('manage')}
              </MenuItem>
            )}
            <button
              onClick={() => signOut({ callbackUrl: '/' })}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <LogOut className="h-4 w-4" />
              {t('logout')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuItem({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      {icon}
      {children}
    </Link>
  );
}
