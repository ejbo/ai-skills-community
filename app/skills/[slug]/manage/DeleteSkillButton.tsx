'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

export function DeleteSkillButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function remove() {
    if (!confirm('确定要删除这个 Skill？此操作不可撤销。')) return;
    start(async () => {
      const res = await fetch(`/api/skills/${slug}`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', '删除失败');
        return;
      }
      pushToast('success', '已删除');
      router.push('/dashboard');
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={remove}
      className="flex h-9 items-center gap-1.5 rounded-lg border border-danger/40 px-4 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      删除 Skill
    </button>
  );
}
