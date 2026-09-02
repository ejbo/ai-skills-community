// 技术专区 — 版规 accordion (server component). The wiki page `rules` split at
// h2/h3 (lib/zones/rules.ts) into numbered `<details>` rows: `<summary>` = mono
// 01 + heading, body = the section's markdown through ZoneMarkdown (compact,
// no heading ids — the wiki page owns those). The intro before the first
// heading renders as a lead paragraph. Disclosure is native — the chevron and
// the row body are CSS-only (M24), no JS animation.
//
// Absent page: wiki editors get RulesCta (creates `/wiki/rules` from the
// template); everyone else sees nothing — the card simply is not there.

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowRight, ChevronDown, Pencil } from 'lucide-react';
import { ZoneMarkdown } from '@/components/zones/ZoneMarkdown';
import { ZONE_RULES_WIKI_SLUG, splitMarkdownSections } from '@/lib/zones/rules';
import { zoneWikiHref } from '@/lib/zones/shared';
import type { WikiPageView } from '@/lib/zones/types';
import { RulesCta } from './RulesCta';
import { CARD_CLS, SECTION_TITLE_CLS } from './ui';

/** M24: CSS grid-rows tween on the row body; `<details>` itself toggles instantly. */
const ROW_BODY_CLS =
  'grid grid-rows-[0fr] transition-[grid-template-rows] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-open:grid-rows-[1fr] motion-reduce:transition-none';

export async function RulesAccordion({
  slug,
  page,
  canWiki,
  allOpen = false,
  className = '',
}: {
  slug: string;
  /** The `rules` wiki page, or null when the zone has none. */
  page: WikiPageView | null;
  canWiki: boolean;
  /** 关于 tab: every row open; the rail keeps them collapsed. */
  allOpen?: boolean;
  className?: string;
}) {
  const t = await getTranslations('zones');
  if (!page) {
    if (!canWiki) return null;
    return (
      <section className={`${CARD_CLS} p-4 ${className}`}>
        <h2 className={SECTION_TITLE_CLS}>{t('rules_title')}</h2>
        <RulesCta slug={slug} className="mt-3 w-full" />
      </section>
    );
  }

  const sections = splitMarkdownSections(page.bodyMd);
  const lead = sections.find((s) => s.heading === null);
  const rules = sections.filter((s) => s.heading !== null);
  const readHref = zoneWikiHref(slug, page.slug || ZONE_RULES_WIKI_SLUG);
  const editHref = `${readHref}/edit`;

  return (
    <section className={`${CARD_CLS} p-4 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className={SECTION_TITLE_CLS}>{t('rules_title')}</h2>
        {canWiki && (
          <Link
            href={editHref}
            aria-label={t('rules_edit')}
            title={t('rules_edit')}
            className="text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {lead && lead.body && (
        <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          <ZoneMarkdown content={lead.body} embeds={page.embeds} compact headingIds={false} />
        </div>
      )}

      {rules.length > 0 && (
        <ol className="mt-1 divide-y divide-zinc-200 dark:divide-zinc-800">
          {rules.map((s, i) => (
            <li key={`${i}:${s.heading}`}>
              <details className="group" open={allOpen || undefined}>
                <summary className="flex cursor-pointer list-none items-center gap-2.5 py-2.5 text-sm font-medium text-zinc-900 outline-none marker:content-none focus-visible:underline dark:text-zinc-50 [&::-webkit-details-marker]:hidden">
                  <span className="w-5 shrink-0 font-mono text-[11px] tabular-nums text-zinc-400">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1">{s.heading}</span>
                  <ChevronDown
                    aria-hidden
                    className="h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform duration-150 group-open:rotate-180"
                  />
                </summary>
                <div className={ROW_BODY_CLS}>
                  <div className="min-h-0 overflow-hidden">
                    <div className="pb-3 pl-[1.875rem] text-sm text-zinc-600 dark:text-zinc-400">
                      {s.body ? (
                        <ZoneMarkdown content={s.body} embeds={page.embeds} compact headingIds={false} />
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </div>
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-200 pt-3 text-xs dark:border-zinc-800">
        <Link
          href={readHref}
          className="group inline-flex items-center gap-1 font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          {t('rules_read_all')}
          <ArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
        {canWiki && (
          <Link href={editHref} className="text-zinc-500 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100">
            {t('rules_edit')}
          </Link>
        )}
      </div>
    </section>
  );
}
