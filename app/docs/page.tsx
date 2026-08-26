import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { DOC_GROUPS } from './_nav';

/** Docs index: every page in the tree as a card, grouped the same way as the sidebar. */
export default async function DocsIndexPage() {
  const t = await getTranslations('docs_page');
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">{t('index_title')}</h1>
      <p className="mt-2 max-w-2xl text-base text-muted">{t('index_intro')}</p>

      <div className="mt-8 flex flex-col gap-8">
        {DOC_GROUPS.map((group) => {
          // The index links out to the real pages; its own row would be a self-link.
          const items = group.items.filter((i) => i.href !== '/docs');
          if (items.length === 0) return null;
          return (
            <section key={group.labelKey}>
              <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
                {t(group.labelKey)}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="card-hover surface group flex flex-col rounded-xl p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm font-semibold group-hover:text-zinc-900 dark:group-hover:text-zinc-50">
                        {t(item.labelKey)}
                      </h3>
                      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 -translate-x-1 text-muted opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{t(item.descKey)}</p>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
