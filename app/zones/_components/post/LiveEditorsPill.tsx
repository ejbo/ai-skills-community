'use client';

// 阅读页头部的「X 正在编辑」提示（docs/contracts/reports.md §4）。只读：GET /editors，
// 60 s 内有心跳的人才算；每 30 s 刷新一次。没人编辑时什么都不渲染。

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PencilLine } from 'lucide-react';
import type { ZonePostEditorView } from '@/lib/zones/types';
import { PILL_MONO } from '../ui';

const REFRESH_MS = 30_000;

export function LiveEditorsPill({ zoneSlug, postId }: { zoneSlug: string; postId: string }) {
  const t = useTranslations('zones');
  const [editors, setEditors] = useState<ZonePostEditorView[]>([]);
  useEffect(() => {
    const url = `/api/zones/${encodeURIComponent(zoneSlug)}/posts/${encodeURIComponent(postId)}/editors`;
    let stopped = false;
    const load = async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const data = (await res.json().catch(() => ({}))) as { editors?: ZonePostEditorView[] };
        if (!stopped && data.editors) setEditors(data.editors);
      } catch {
        /* 下次再试 */
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [zoneSlug, postId]);
  if (!editors.length) return null;
  const names = editors.map((e) => e.user.displayName).join('、');
  return (
    <span className={PILL_MONO} title={names}>
      <PencilLine className="h-3 w-3" aria-hidden />
      {t('post_live_editing', { names })}
    </span>
  );
}
