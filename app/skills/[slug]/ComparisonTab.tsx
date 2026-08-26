import Link from 'next/link';
import { Pencil } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
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
export async function ComparisonTab({
  slug,
  privileged,
  comparison,
}: {
  slug: string;
  privileged: boolean;
  comparison: ComparisonRow | null;
}) {
  const t = await getTranslations('skill_compare');

  if (comparison?.status === 'published') {
    return <ComparisonView bodyMd={comparison.bodyMd} example={parseComparisonExample(comparison.example)} />;
  }

  if (privileged) {
    return (
      <div className="surface flex flex-col items-center gap-3 rounded-2xl px-6 py-10 text-center">
        <p className="text-sm text-muted">{t('tab_none_published')}</p>
        <Link
          href={`/skills/${slug}/manage?section=comparison`}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 text-sm font-medium text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-300"
        >
          <Pencil className="h-3.5 w-3.5" />
          {t('tab_go_edit')}
        </Link>
      </div>
    );
  }

  return <p className="text-sm text-muted">{t('tab_author_none_published')}</p>;
}
