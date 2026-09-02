'use client';

// 技术专区 — 添加版规: creates the wiki page `rules` from the house template
// and lands the editor on it. Shown only to wiki editors of a zone that has no
// rules page yet (the RSC decides — this button never re-derives permissions).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, Plus } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { ZONE_RULES_WIKI_SLUG } from '@/lib/zones/rules';
import { zoneWikiHref } from '@/lib/zones/shared';
import { BTN_SECONDARY, readError } from './ui';

export function RulesCta({ slug, className = '' }: { slug: string; className?: string }) {
  const t = useTranslations('zones');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/zones/${encodeURIComponent(slug)}/wiki`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: t('rules_page_title'), slug: ZONE_RULES_WIKI_SLUG, bodyMd: t('rules_template') }),
      });
      if (!res.ok) {
        const err = await readError(res);
        pushToast('error', err.reason ?? t('action_failed'));
        return;
      }
      // The server suffixes a taken slug (`rules-2`) — follow what it actually created.
      const data = (await res.json().catch(() => ({}))) as { slug?: string };
      pushToast('success', t('rules_created'));
      router.push(`${zoneWikiHref(slug, data.slug || ZONE_RULES_WIKI_SLUG)}/edit`);
      router.refresh();
    } catch {
      pushToast('error', t('action_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={() => void create()} disabled={busy} className={`${BTN_SECONDARY} ${className}`}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
      {t('rules_add')}
    </button>
  );
}
