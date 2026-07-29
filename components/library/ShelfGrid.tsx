'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import type { DocCardData } from '@/lib/library-queries';
import { DocCard } from './DocCard';

/** 书架卡片数据：RSC → client 边界上日期已序列化为 ISO 字符串。 */
export type ShelfDocData = Omit<DocCardData, 'createdAt'> & { createdAt: string };

/** 书架卡片网格：DocCard + 悬浮「移出」按钮（Link 的兄弟节点，绝对定位覆盖）。 */
export function ShelfGrid({ docs }: { docs: ShelfDocData[] }) {
  const router = useRouter();
  const [removing, setRemoving] = useState<string | null>(null);

  async function remove(docId: string) {
    if (removing) return;
    setRemoving(docId);
    try {
      const res = await fetch(`/api/library/docs/${docId}/shelf`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      pushToast('success', '已移出书架');
      router.refresh();
    } catch {
      pushToast('error', '操作失败，请重试');
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {docs.map((doc) => (
        <div key={doc.id} className="group/shelf relative">
          <DocCard {...doc} />
          <button
            onClick={() => remove(doc.id)}
            disabled={removing === doc.id}
            title="移出书架"
            aria-label="移出书架"
            className="absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-lg border border-zinc-200 bg-white/90 text-muted opacity-0 shadow-sm transition hover:border-danger/40 hover:text-danger focus-visible:opacity-100 disabled:opacity-60 group-hover/shelf:opacity-100 dark:border-zinc-700 dark:bg-zinc-900/90"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
