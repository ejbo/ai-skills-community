'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { pushToast } from '@/components/Toaster';

type Status = 'draft' | 'published' | 'archived';
type Source = 'internal' | 'user_uploaded' | 'external_curated';

export function SkillStatusActions({
  slug,
  status,
  sourceType,
}: {
  slug: string;
  status: Status;
  sourceType: Source;
}) {
  const router = useRouter();
  const [s, setS] = useState<Status>(status);
  const [src, setSrc] = useState<Source>(sourceType);
  const [, startTransition] = useTransition();

  function setStatus(next: Status) {
    setS(next);
    startTransition(async () => {
      const res = await fetch(`/api/admin/skills/${slug}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        setS(status);
        pushToast('error', '操作失败');
      } else {
        pushToast('success', `已切换为 ${next}`);
        router.refresh();
      }
    });
  }

  function setSourceType(next: Source) {
    setSrc(next);
    startTransition(async () => {
      const res = await fetch(`/api/admin/skills/${slug}/source-type`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceType: next }),
      });
      if (!res.ok) {
        setSrc(sourceType);
        pushToast('error', '操作失败');
      } else {
        pushToast('success', '来源已更新');
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <select
        value={s}
        onChange={(e) => setStatus(e.target.value as Status)}
        className="h-6 rounded border border-zinc-200 bg-white px-1 text-[11px] dark:border-zinc-800 dark:bg-zinc-900"
      >
        <option value="published">发布</option>
        <option value="draft">草稿</option>
        <option value="archived">归档</option>
      </select>
      <select
        value={src}
        onChange={(e) => setSourceType(e.target.value as Source)}
        className="h-6 rounded border border-zinc-200 bg-white px-1 text-[11px] dark:border-zinc-800 dark:bg-zinc-900"
      >
        <option value="user_uploaded">社区</option>
        <option value="internal">内部</option>
        <option value="external_curated">搬运</option>
      </select>
    </div>
  );
}
