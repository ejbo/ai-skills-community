'use client';

// 技术专区后台的二级导航（/manage 全站中文）：版块 / 组织架构 / 栏目预设 / 首页设置。
// 四个页面顶部都渲染它；当前页按 pathname 前缀高亮（/manage/zones 只在精确匹配时高亮，
// 否则每个子页都会把「版块」一起点亮）。

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS: ReadonlyArray<{ href: string; label: string; exact?: boolean }> = [
  { href: '/manage/zones', label: '版块', exact: true },
  { href: '/manage/zones/org', label: '组织架构' },
  { href: '/manage/zones/columns', label: '栏目预设' },
  { href: '/manage/zones/settings', label: '首页设置' },
];

export function ZonesSubNav() {
  const pathname = usePathname() ?? '';
  return (
    <nav aria-label="技术专区后台" className="flex flex-wrap items-center gap-1 rounded-xl border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-950">
      {ITEMS.map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
              active
                ? 'bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900'
                : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
