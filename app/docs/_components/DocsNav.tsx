'use client';

// Docs sidebar. Client-only for the active-route highlight; labels arrive
// pre-translated from the RSC layout so next-intl stays server-side.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavGroup {
  label: string;
  items: { href: string; label: string }[];
}

export function DocsNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
            {group.label}
          </div>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              // Exact match only — /docs must not stay lit on /docs/start.
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-lg px-3 py-1.5 text-sm transition ${
                    active
                      ? 'bg-zinc-900/[0.06] dark:bg-white/10 font-medium text-zinc-900 dark:text-zinc-50'
                      : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
