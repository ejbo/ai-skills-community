import { Sparkles, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';

export interface ComparisonExampleView {
  taskPrompt: string;
  withOutput: string;
  withoutOutput: string;
}

// Presentational and sync → usable from both the server visitor view and the
// client author preview (`useTranslations` resolves to the RSC or the client
// implementation depending on where it is mounted). Renders the structured
// analysis report (bodyMd) plus the real "Before / After" dual-run.
export function ComparisonView({
  bodyMd,
  example,
}: {
  bodyMd?: string | null;
  example?: ComparisonExampleView | null;
}) {
  const t = useTranslations('skill_compare');
  if (!bodyMd && !example) {
    return <p className="text-sm text-muted">{t('view_empty')}</p>;
  }
  return (
    <div className="space-y-6">
      {bodyMd ? (
        <div className="surface rounded-2xl p-5">
          <MarkdownRenderer content={bodyMd} />
        </div>
      ) : null}

      {example ? (
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">{t('real_test')}</div>
          <div className="surface rounded-xl p-3">
            <div className="mb-1 text-[11px] font-medium text-muted">{t('task_prompt')}</div>
            <p className="whitespace-pre-wrap text-sm">{example.taskPrompt}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <OutputColumn
              title={t('without_skill')}
              icon={<Zap className="h-3.5 w-3.5 text-muted" />}
              text={example.withoutOutput}
              emptyText={t('empty_output_md')}
            />
            <OutputColumn
              title={t('with_skill')}
              icon={<Sparkles className="h-3.5 w-3.5 text-accent-600" />}
              text={example.withOutput}
              emptyText={t('empty_output_md')}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OutputColumn({
  title,
  icon,
  text,
  emptyText,
}: {
  title: string;
  icon: React.ReactNode;
  text: string;
  emptyText: string;
}) {
  return (
    <div className="surface flex flex-col rounded-2xl p-4">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
        {icon}
        {title}
      </div>
      <div className="text-sm leading-relaxed">
        <MarkdownRenderer content={text || emptyText} />
      </div>
    </div>
  );
}
