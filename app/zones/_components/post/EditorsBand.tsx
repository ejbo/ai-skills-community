'use client';

// 技术专区 — 「X 也在编辑」提示带（docs/contracts/reports.md §4）。
// 已有帖子的编辑器每 PRESENCE_HEARTBEAT_MS PUT 一次心跳，返回其他在线编辑者；离开时
// DELETE（卸载用 fetch keepalive，关标签页用 sendBeacon 打 POST 别名）。这是提示不是锁。

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Users } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { withBasePath } from '@/lib/base-path';
import type { ZonePostEditorView } from '@/lib/zones/types';
import { RelTime } from '../RelTime';

// 与 lib/zones/post-presence.ts 的 PRESENCE_HEARTBEAT_MS 一致（那边是服务端模块，不能进客户端包）。
const HEARTBEAT_MS = 20_000;

export function EditorsBand({ zoneSlug, postId }: { zoneSlug: string; postId: string }) {
  const t = useTranslations('zones');
  const [editors, setEditors] = useState<ZonePostEditorView[]>([]);

  useEffect(() => {
    const url = `/api/zones/${encodeURIComponent(zoneSlug)}/posts/${encodeURIComponent(postId)}/editors`;
    let stopped = false;
    const beat = async () => {
      try {
        const res = await fetch(url, { method: 'PUT' });
        if (!res.ok) return;
        const data = (await res.json().catch(() => ({}))) as { editors?: ZonePostEditorView[] };
        if (!stopped && data.editors) setEditors(data.editors);
      } catch {
        /* 网络抖动：下一次心跳再试 */
      }
    };
    void beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    // 关标签页 / 整页离开：sendBeacon 打 POST 别名（切换标签页不算离开，心跳照常）。
    const onPageHide = () => {
      // sendBeacon 不走 fetch shim，basePath 要自己补。
      navigator.sendBeacon?.(withBasePath(url));
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('pagehide', onPageHide);
      void fetch(url, { method: 'DELETE', keepalive: true }).catch(() => {});
    };
  }, [zoneSlug, postId]);

  if (!editors.length) return null;
  return (
    <div role="status" className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
      <Users className="h-4 w-4 shrink-0 text-muted" aria-hidden />
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {editors.map((e) => (
          <span key={e.user.handle} className="inline-flex items-center gap-1.5">
            <Avatar name={e.user.displayName} src={e.user.avatarUrl} size="xs" handle={e.user.handle} />
            <span className="font-medium">{e.user.displayName}</span>
            <span className="text-muted" suppressHydrationWarning>
              {t('editors_since')} <RelTime at={e.startedAt} />
            </span>
          </span>
        ))}
      </span>
      <span className="text-xs text-muted">{t('editors_hint')}</span>
    </div>
  );
}
