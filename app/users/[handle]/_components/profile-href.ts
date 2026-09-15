// 个人主页 URL builder — plain module (no 'use client'): the RSC page, the tab
// bar items and the pager all build hrefs through it, so 访客视角 (`?as=visitor`)
// survives every tab switch and page turn, and the default tab never carries a
// `tab` param (the canonical /users/<handle> stays shareable).

import type { ProfileTab } from '@/lib/profile/shared';

export interface ProfileHrefOptions {
  tab?: ProfileTab;
  page?: number;
  cursor?: string | null;
  /** Keep the owner in 访客视角. */
  visitor?: boolean;
}

export function profileHref(handle: string, opts: ProfileHrefOptions = {}): string {
  const params = new URLSearchParams();
  if (opts.tab && opts.tab !== 'overview') params.set('tab', opts.tab);
  if (opts.page && opts.page > 1) params.set('page', String(opts.page));
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (opts.visitor) params.set('as', 'visitor');
  const qs = params.toString();
  return `/users/${encodeURIComponent(handle)}${qs ? `?${qs}` : ''}`;
}
