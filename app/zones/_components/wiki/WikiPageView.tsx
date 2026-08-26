'use client';

// 技术专区 Wiki — page article: breadcrumb, title, meta (最后编辑 / 修订数),
// actions (编辑 / 新建子页 / 历史 / 删除 for canWiki), the server-rendered body
// (passed in as `body` — ZoneMarkdown is an RSC), a right-rail TOC (xl) and the
// child-page list. Heading ids are assigned by ZoneMarkdown's own client
// effect (same slug + dedupe scheme as the server's `extractHeadings`); the TOC
// only keeps the server headings that actually landed in the DOM and re-syncs
// on ZONE_HEADINGS_READY_EVENT, so it never fights the body over ids.

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useReducedMotion } from 'framer-motion';
import { ChevronRight, CornerDownRight, FilePlus2, History, Loader2, Pencil, Trash2 } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { pushToast } from '@/components/Toaster';
import { TabBar } from '@/components/motion';
import { ZONE_HEADINGS_READY_EVENT } from '@/components/zones/ZoneMarkdown';
import { relativeTime } from '@/lib/i18n-date';
import { zoneWikiHref, type MdHeading } from '@/lib/zones/shared';
import type { WikiPageView as WikiPageData } from '@/lib/zones/types';

export interface WikiCrumb {
  slug: string;
  title: string;
}

export interface WikiPageViewProps {
  zoneSlug: string;
  page: WikiPageData;
  canWiki: boolean;
  /** `<ZoneMarkdown content={page.bodyMd} embeds={page.embeds} />` rendered by the RSC. */
  body: ReactNode;
  /** Root → parent (excluding the page itself). */
  ancestors: WikiCrumb[];
  childPages: WikiCrumb[];
}

const SECONDARY_BTN =
  'inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-zinc-50';

export function WikiPageView({ zoneSlug, page, canWiki, body, ancestors, childPages }: WikiPageViewProps) {
  const t = useTranslations('zones');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const articleRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const historyHref = `${zoneWikiHref(zoneSlug, page.slug)}/history`;
  const editor = page.updatedBy;

  async function remove() {
    if (busy) return;
    if (!window.confirm(t('wiki_delete_confirm', { title: page.title }))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/zones/${zoneSlug}/wiki/${page.id}`, { method: 'DELETE' });
      if (res.status === 401) {
        pushToast('error', t('wiki_login_required'));
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
      if (!res.ok) {
        pushToast('error', data.reason ?? t('wiki_delete_failed'));
        return;
      }
      pushToast('success', t('wiki_deleted'));
      router.push(zoneWikiHref(zoneSlug));
      router.refresh();
    } catch {
      pushToast('error', t('wiki_delete_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_200px]">
      <div className="min-w-0">
        <nav aria-label={t('wiki_breadcrumb_root')} className="flex flex-wrap items-center gap-1 text-xs text-muted">
          <Link href={zoneWikiHref(zoneSlug)} className="hover:text-zinc-900 dark:hover:text-zinc-50">
            {t('wiki_breadcrumb_root')}
          </Link>
          {ancestors.map((a) => (
            <span key={a.slug} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3" />
              <Link
                href={zoneWikiHref(zoneSlug, a.slug)}
                className="max-w-[12rem] truncate hover:text-zinc-900 dark:hover:text-zinc-50"
              >
                {a.title}
              </Link>
            </span>
          ))}
          <span className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3" />
            <span className="max-w-[16rem] truncate text-zinc-700 dark:text-zinc-300">{page.title}</span>
          </span>
        </nav>

        <header className="mt-3 border-b border-zinc-200 pb-5 dark:border-zinc-800">
          <h1 className="break-words text-2xl font-semibold tracking-tight md:text-3xl">{page.title}</h1>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted">
              <span>{t('wiki_last_edited_by')}</span>
              <Avatar name={editor.displayName} src={editor.avatarUrl} size="xs" />
              <Link href={`/users/${editor.handle}`} className="truncate hover:underline">
                {editor.displayName}
              </Link>
              <DeptTag department={editor.department} lab={editor.lab} />
              <span>·</span>
              <time dateTime={page.updatedAt}>{relativeTime(page.updatedAt, locale)}</time>
              <span>·</span>
              <Link href={historyHref} className="font-mono tabular-nums hover:underline">
                {t('wiki_revisions_n', { count: page.revisionCount })}
              </Link>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <Link href={historyHref} className={SECONDARY_BTN}>
                <History className="h-3.5 w-3.5" />
                {t('wiki_history')}
              </Link>
              {canWiki && (
                <>
                  <Link href={`${zoneWikiHref(zoneSlug, page.slug)}/edit`} className={SECONDARY_BTN}>
                    <Pencil className="h-3.5 w-3.5" />
                    {t('wiki_edit')}
                  </Link>
                  <Link
                    href={`/zones/${zoneSlug}/wiki/new?parent=${encodeURIComponent(page.id)}`}
                    className={SECONDARY_BTN}
                  >
                    <FilePlus2 className="h-3.5 w-3.5" />
                    {t('wiki_new_child')}
                  </Link>
                  <button
                    type="button"
                    onClick={remove}
                    disabled={busy}
                    className={`${SECONDARY_BTN} hover:text-danger dark:hover:text-danger`}
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    {t('wiki_delete')}
                  </button>
                </>
              )}
            </div>
          </div>
        </header>

        <div ref={articleRef} className="mt-6">
          {body}
        </div>

        {childPages.length > 0 && (
          <section className="mt-10 border-t border-zinc-200 pt-5 dark:border-zinc-800">
            <h2 className="mb-3 text-sm font-semibold">{t('wiki_child_pages')}</h2>
            <ul className="grid gap-1 sm:grid-cols-2">
              {childPages.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={zoneWikiHref(zoneSlug, c.slug)}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                  >
                    <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    <span className="truncate">{c.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside className="hidden xl:block">
        <div className="sticky top-20">
          <WikiToc headings={page.headings} rootRef={articleRef} />
        </div>
      </aside>
    </div>
  );
}

// ── TOC ──────────────────────────────────────────────────────────────────────

const SCROLL_OFFSET_PX = 96;

function WikiToc({ headings, rootRef }: { headings: MdHeading[]; rootRef: RefObject<HTMLDivElement> }) {
  const t = useTranslations('zones');
  const reduce = useReducedMotion();
  const [items, setItems] = useState<MdHeading[]>(headings);
  const [active, setActive] = useState<string>(headings[0]?.id ?? '');

  // Keep only the server headings whose ids exist under the article root
  // (ZoneMarkdown assigns them after mount and on every content change).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const sync = () => {
      const present = new Map<string, HTMLElement>();
      root.querySelectorAll<HTMLElement>('h1, h2, h3, h4').forEach((el) => {
        if (el.id) present.set(el.id, el);
      });
      const matched = headings.filter((h) => {
        const el = present.get(h.id);
        if (!el) return false;
        el.style.scrollMarginTop = `${SCROLL_OFFSET_PX}px`;
        return true;
      });
      setItems((prev) =>
        prev.length === matched.length && prev.every((p, i) => p.id === matched[i].id) ? prev : matched,
      );
    };
    sync();
    window.addEventListener(ZONE_HEADINGS_READY_EVENT, sync);
    return () => window.removeEventListener(ZONE_HEADINGS_READY_EVENT, sync);
  }, [headings, rootRef]);

  // Active heading = the last one whose top has passed the offset line.
  useEffect(() => {
    if (items.length === 0) return;
    let raf = 0;
    const compute = () => {
      raf = 0;
      let current = items[0].id;
      for (const h of items) {
        const el = document.getElementById(h.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - SCROLL_OFFSET_PX <= 0) current = h.id;
        else break;
      }
      setActive((prev) => (prev === current ? prev : current));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [items]);

  if (items.length < 2) return null;

  const minLevel = Math.min(...items.map((h) => h.level));
  const tabs = items.map((h) => ({
    key: h.id,
    // U+2003 (em space) is not collapsed by `white-space: normal`, so nested
    // levels indent without per-tab styling hooks on TabBar.
    label: `${' '.repeat(Math.max(0, h.level - minLevel))}${h.text}`,
  }));

  function jump(key: string) {
    const el = document.getElementById(key);
    if (!el) return;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    window.history.replaceState(null, '', `#${key}`);
    setActive(key);
  }

  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('wiki_toc')}</div>
      <TabBar
        tabs={tabs}
        active={active}
        id="wiki-toc"
        orientation="vertical"
        ariaLabel={t('wiki_toc')}
        onSelect={jump}
        className="max-h-[calc(100vh-8rem)] overflow-y-auto scroll-thin text-xs"
      />
    </div>
  );
}
