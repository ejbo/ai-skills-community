'use client';

// 合著者 picker — SITE-WIDE (owner ask 2026-09-02: 「添加合著者我希望是可以整个
// 平台的人都可以添加」). The search box, results and chips are the house
// `PeoplePicker` (components/people/PeoplePicker.tsx — shared with 指定成员可见), over
// `GET /api/users/search?q=`, which matches on 姓名 and 工号 (digit run,
// order-insensitive name tokens) and trims every row through `toPublicAuthor` — so a
// private account's 部门/研究所 never arrives here and the 工号 is matched but never
// returned. This wrapper only brings the zone copy, the cap and the hint.
//
// The server keeps the rest of the contract: `maxCoauthors`, self-exclusion,
// dedupe, wholesale replacement on edit — and a co-author who is not a member of
// this 版块 gets the byline and can READ the post, but may not edit it
// (`canEditZonePostContent` in lib/zones/post-queries.ts). That is what the hint
// under the row says out loud.

import { useTranslations } from 'next-intl';
import { PeoplePicker, type PersonPick } from '@/components/people/PeoplePicker';
import { ZONE_LIMITS } from '@/lib/zones/shared';

export type CoauthorPick = PersonPick;

export function CoauthorPicker({
  value,
  onChange,
  selfHandle,
  disabled = false,
}: {
  /**
   * Kept for the call site's prop shape (ComposerSettingsSheet passes it) —
   * the search is site-wide now, so the zone plays no part in it.
   */
  zoneSlug?: string;
  value: CoauthorPick[];
  onChange: (next: CoauthorPick[]) => void;
  selfHandle: string;
  disabled?: boolean;
}) {
  const t = useTranslations('zones');
  const full = value.length >= ZONE_LIMITS.maxCoauthors;
  return (
    <div>
      <PeoplePicker
        value={value}
        onChange={onChange}
        max={ZONE_LIMITS.maxCoauthors}
        excludeHandles={[selfHandle]}
        disabled={disabled}
        labels={{
          add: t('composer_coauthor_add'),
          search: t('composer_coauthor_search_site'),
          prompt: t('composer_coauthor_prompt'),
          noMatch: t('composer_coauthor_no_match'),
          remove: (name) => t('composer_coauthor_remove', { name }),
        }}
      />
      <p className="mt-1.5 text-[11px] text-muted">
        {full ? t('composer_coauthor_full', { max: ZONE_LIMITS.maxCoauthors }) : t('composer_coauthor_hint')}
      </p>
    </div>
  );
}
