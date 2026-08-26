'use client';

// 技术专区 Wiki — create / edit form. Title, slug (auto via slugifyAscii until
// the author touches it; validated by isValidWikiSlug; blank on create lets the
// server mint `page-<nanoid>`), parent select from the tree (self + descendants
// excluded when editing), RichTextEditor with the zone embed picker, 修订说明.
// POST /wiki (201 { id, slug }) or PATCH /wiki/[pageId] ({ ok }) → router.push.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, Save } from 'lucide-react';
import { RichTextEditor } from '@/components/RichTextEditor';
import { pushToast } from '@/components/Toaster';
import { Magnetic } from '@/components/motion';
import { ZONE_LIMITS, isValidWikiSlug, slugifyAscii, zoneWikiHref } from '@/lib/zones/shared';
import type { WikiTreeNode } from '@/lib/zones/types';

const WIKI_SLUG_MAX = 60;

export interface WikiEditorPage {
  id: string;
  slug: string;
  title: string;
  bodyMd: string;
  parentId: string | null;
}

export interface WikiEditorProps {
  zoneSlug: string;
  tree: WikiTreeNode[];
  /** Present ⇒ edit mode. */
  page?: WikiEditorPage | null;
  /** Preselected parent for a new page (`?parent=`). */
  initialParentId?: string | null;
}

interface ParentOption {
  id: string;
  title: string;
  depth: number;
}

function flattenForSelect(
  nodes: WikiTreeNode[],
  excludeId: string | null,
  depth = 0,
  out: ParentOption[] = [],
): ParentOption[] {
  for (const n of nodes) {
    if (n.id === excludeId) continue; // skips the whole subtree — a page can't move under itself
    out.push({ id: n.id, title: n.title, depth });
    flattenForSelect(n.children, excludeId, depth + 1, out);
  }
  return out;
}

const INPUT_CLS =
  'h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-600';
const LABEL_CLS = 'mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400';

export function WikiEditor({ zoneSlug, tree, page = null, initialParentId = null }: WikiEditorProps) {
  const t = useTranslations('zones');
  const router = useRouter();
  const pathname = usePathname();
  const editing = !!page;

  const [title, setTitle] = useState(page?.title ?? '');
  const [slug, setSlug] = useState(page?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(editing);
  const [parentId, setParentId] = useState<string>(page?.parentId ?? initialParentId ?? '');
  const [bodyMd, setBodyMd] = useState(page?.bodyMd ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const savedRef = useRef(false);

  const parentOptions = useMemo(() => flattenForSelect(tree, page?.id ?? null), [tree, page?.id]);
  // A stale `?parent=` (deleted page / other zone) must not survive to the payload.
  const parentValid = parentId === '' || parentOptions.some((o) => o.id === parentId);
  const effectiveParent = parentValid ? parentId : '';

  const dirty =
    title !== (page?.title ?? '') ||
    slug !== (page?.slug ?? '') ||
    bodyMd !== (page?.bodyMd ?? '') ||
    effectiveParent !== (page?.parentId ?? initialParentId ?? '') ||
    note !== '';

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (savedRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  function onTitleChange(v: string) {
    setTitle(v);
    if (!slugTouched) setSlug(slugifyAscii(v, WIKI_SLUG_MAX));
  }

  const slugTrimmed = slug.trim().toLowerCase();
  const slugError = slugTrimmed !== '' && !isValidWikiSlug(slugTrimmed);
  const titleTrimmed = title.trim();
  const titleError =
    titleTrimmed.length === 0
      ? t('wiki_title_required')
      : titleTrimmed.length > ZONE_LIMITS.wikiTitleMax
        ? t('wiki_title_too_long', { max: ZONE_LIMITS.wikiTitleMax })
        : null;
  const bodyError = bodyMd.length > ZONE_LIMITS.wikiBodyMax ? t('wiki_body_too_long') : null;
  const canSubmit = !busy && !titleError && !slugError && !bodyError && (!editing || slugTrimmed !== '');

  async function submit() {
    if (!canSubmit) {
      if (titleError) pushToast('error', titleError);
      else if (slugError || (editing && slugTrimmed === '')) pushToast('error', t('wiki_slug_invalid'));
      else if (bodyError) pushToast('error', bodyError);
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        title: titleTrimmed,
        bodyMd,
        parentId: effectiveParent || null,
        note: note.trim().slice(0, ZONE_LIMITS.wikiNoteMax),
      };
      if (slugTrimmed) payload.slug = slugTrimmed;
      const res = await fetch(
        editing ? `/api/zones/${zoneSlug}/wiki/${page.id}` : `/api/zones/${zoneSlug}/wiki`,
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (res.status === 401) {
        pushToast('error', t('wiki_login_required'));
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string; slug?: string; error?: string; reason?: string };
      if (!res.ok) {
        pushToast('error', data.reason ?? t('wiki_save_failed'));
        return;
      }
      savedRef.current = true;
      pushToast('success', editing ? t('wiki_saved') : t('wiki_created'));
      const targetSlug = (typeof data.slug === 'string' && data.slug) || slugTrimmed || page?.slug || '';
      router.push(zoneWikiHref(zoneSlug, targetSlug || null));
      router.refresh();
    } catch {
      pushToast('error', t('wiki_save_failed'));
    } finally {
      setBusy(false);
    }
  }

  const cancelHref = editing ? zoneWikiHref(zoneSlug, page.slug) : zoneWikiHref(zoneSlug);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-6"
    >
      <div className="surface space-y-5 rounded-2xl p-5">
        <div>
          <label htmlFor="wiki-title" className={LABEL_CLS}>
            {t('wiki_field_title')}
          </label>
          <input
            id="wiki-title"
            autoFocus={!editing}
            value={title}
            maxLength={ZONE_LIMITS.wikiTitleMax}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder={t('wiki_title_placeholder')}
            className={`${INPUT_CLS} h-11 text-base font-medium`}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="wiki-slug" className={LABEL_CLS}>
              {t('wiki_field_slug')}
              {!slugTouched && (
                <span className="ml-2 rounded border border-zinc-200 px-1 py-px font-mono text-[10px] uppercase text-muted dark:border-zinc-800">
                  {t('wiki_slug_auto')}
                </span>
              )}
            </label>
            <div className="flex items-center">
              <span className="hidden h-10 shrink-0 items-center rounded-l-lg border border-r-0 border-zinc-200 bg-zinc-50 px-2.5 font-mono text-xs text-muted dark:border-zinc-800 dark:bg-zinc-900/60 md:flex">
                /wiki/
              </span>
              <input
                id="wiki-slug"
                value={slug}
                maxLength={WIKI_SLUG_MAX}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase());
                }}
                placeholder={t('wiki_slug_placeholder')}
                aria-invalid={slugError}
                spellCheck={false}
                className={`${INPUT_CLS} font-mono md:rounded-l-none ${slugError ? 'border-danger focus:border-danger' : ''}`}
              />
            </div>
            <p className={`mt-1 text-[11px] ${slugError ? 'text-danger' : 'text-muted'}`}>
              {slugError ? t('wiki_slug_invalid') : t('wiki_slug_hint')}
            </p>
          </div>

          <div>
            <label htmlFor="wiki-parent" className={LABEL_CLS}>
              {t('wiki_field_parent')}
            </label>
            <select
              id="wiki-parent"
              value={effectiveParent}
              onChange={(e) => setParentId(e.target.value)}
              className={INPUT_CLS}
            >
              <option value="">{t('wiki_parent_none')}</option>
              {parentOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {'　'.repeat(o.depth)}
                  {o.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <span className={LABEL_CLS}>{t('wiki_field_body')}</span>
          <RichTextEditor
            value={bodyMd}
            onChange={setBodyMd}
            variant="full"
            placeholder={t('wiki_body_placeholder')}
            maxLength={ZONE_LIMITS.wikiBodyMax}
            ariaLabel={t('wiki_field_body')}
            embedPicker={{ zoneSlug }}
          />
          {bodyError && <p className="mt-1 text-[11px] text-danger">{bodyError}</p>}
        </div>

        <div>
          <label htmlFor="wiki-note" className={LABEL_CLS}>
            {t('wiki_field_note')}
          </label>
          <input
            id="wiki-note"
            value={note}
            maxLength={ZONE_LIMITS.wikiNoteMax}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('wiki_note_placeholder')}
            className={INPUT_CLS}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link
          href={cancelHref}
          className="inline-flex h-9 items-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {t('wiki_cancel')}
        </Link>
        <Magnetic>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {busy ? t('wiki_saving') : editing ? t('wiki_save') : t('wiki_create')}
          </button>
        </Magnetic>
      </div>
    </form>
  );
}
