import { BookOpen } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { DOC_GROUPS } from './_nav';
import { DocsNav } from './_components/DocsNav';

export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('docs_page');
  const tNav = await getTranslations('nav');
  const groups = DOC_GROUPS.map((g) => ({
    label: t(g.labelKey),
    items: g.items.map((i) => ({ href: i.href, label: t(i.labelKey) })),
  }));
  return (
    <div className="container py-8">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="mb-4 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
            <BookOpen className="h-3.5 w-3.5" />
            {tNav('docs')}
          </div>
          <DocsNav groups={groups} />
        </aside>
        <article className="min-w-0">{children}</article>
      </div>
    </div>
  );
}
