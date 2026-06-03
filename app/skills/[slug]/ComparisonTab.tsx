import { parseComparisonExample } from '@/lib/comparison';
import { ComparisonView } from './ComparisonView';
import { ComparisonStudio } from './ComparisonStudio';

export interface ComparisonRow {
  status: string;
  bodyMd: string | null;
  example: unknown;
  guidancePrompt: string | null;
  model: string | null;
}

// Author/admin get the workshop; visitors get the published structured view.
// The page only mounts this tab when `privileged || a published comparison exists`.
export function ComparisonTab({
  slug,
  privileged,
  comparison,
  stale,
}: {
  slug: string;
  privileged: boolean;
  comparison: ComparisonRow | null;
  stale: boolean;
}) {
  const example = parseComparisonExample(comparison?.example);

  if (privileged) {
    return (
      <ComparisonStudio
        slug={slug}
        initial={{
          status: comparison?.status ?? null,
          bodyMd: comparison?.bodyMd ?? '',
          example,
          guidancePrompt: comparison?.guidancePrompt ?? '',
          model: comparison?.model ?? null,
          stale,
        }}
      />
    );
  }

  if (!comparison || comparison.status !== 'published') {
    return <p className="text-sm text-muted">作者还没有发布对比。</p>;
  }
  return <ComparisonView bodyMd={comparison.bodyMd} example={example} />;
}
