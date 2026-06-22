import Link from 'next/link';
import { Pencil } from 'lucide-react';
import { parseComparisonExample } from '@/lib/comparison';
import { ComparisonView } from './ComparisonView';

export interface ComparisonRow {
  status: string;
  bodyMd: string | null;
  example: unknown;
  guidancePrompt: string | null;
  model: string | null;
}

// Everyone — author included — sees the published visitor view here. Editing now
// lives in 管理 → 对比 (ComparisonStudio), so the public tab never mounts the editor.
// When nothing is published, the author gets a CTA into the studio.
export function ComparisonTab({
  slug,
  privileged,
  comparison,
}: {
  slug: string;
  privileged: boolean;
  comparison: ComparisonRow | null;
}) {
  if (comparison?.status === 'published') {
    return <ComparisonView bodyMd={comparison.bodyMd} example={parseComparisonExample(comparison.example)} />;
  }

  if (privileged) {
    return (
      <div className="surface flex flex-col items-center gap-3 rounded-2xl px-6 py-10 text-center">
        <p className="text-sm text-muted">
          还没有发布对比。到「管理 → 对比」用 AI 一键生成并发布，访客就能在这里看到「装上 vs 不装」的差别。
        </p>
        <Link
          href={`/skills/${slug}/manage?section=comparison`}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600"
        >
          <Pencil className="h-3.5 w-3.5" />
          去编辑对比
        </Link>
      </div>
    );
  }

  return <p className="text-sm text-muted">作者还没有发布对比。</p>;
}
