'use client';

// 可见范围 control — generic (docs/contracts/audience.md). Three options:
//   公开 · 指定成员可见 · 隐藏（仅自己和管理员）
// and, under 指定成员可见, the house PeoplePicker (姓名 / 工号 search). Controlled: the
// surface owns the state and how it saves (votes: PATCH /api/votes/[id] with
// { visibility, audienceUserIds }). Copy lives in the `audience` namespace and is
// written surface-neutral (「内容」), so a new surface needs no new strings.
//
// Chrome is ink-only (配色契约): the selected option is a zinc-900 / zinc-100 ring and
// dot, never an accent colour.

import { useTranslations } from 'next-intl';
import { EyeOff, Globe2, Users } from 'lucide-react';
import { PeoplePicker } from '@/components/people/PeoplePicker';
import { MAX_AUDIENCE, type AudiencePick, type ContentVisibility } from '@/lib/audience-shared';

const ICONS: Record<ContentVisibility, typeof Globe2> = {
  public: Globe2,
  audience: Users,
  private: EyeOff,
};

const ORDER: ContentVisibility[] = ['public', 'audience', 'private'];

export function VisibilityField({
  visibility,
  onVisibilityChange,
  audience,
  onAudienceChange,
  selfHandle,
  disabled = false,
}: {
  visibility: ContentVisibility;
  onVisibilityChange: (v: ContentVisibility) => void;
  audience: AudiencePick[];
  onAudienceChange: (next: AudiencePick[]) => void;
  /** The owner — implicit on every list, so never offered by the picker. */
  selfHandle?: string | null;
  disabled?: boolean;
}) {
  const t = useTranslations('audience');

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label={t('visibility_label')} className="grid gap-2 sm:grid-cols-3">
        {ORDER.map((v) => {
          const Icon = ICONS[v];
          const selected = visibility === v;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onVisibilityChange(v)}
              className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-60 ${
                selected
                  ? 'border-zinc-900 ring-1 ring-zinc-900 dark:border-zinc-100 dark:ring-zinc-100'
                  : 'border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600'
              }`}
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? '' : 'text-muted'}`} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t(`opt_${v}`)}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted">{t(`opt_${v}_hint`)}</span>
              </span>
            </button>
          );
        })}
      </div>

      {visibility === 'audience' && (
        <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="mb-2 text-xs font-medium">{t('members_label')}</p>
          <PeoplePicker
            panel="inline"
            value={audience}
            onChange={onAudienceChange}
            max={MAX_AUDIENCE}
            excludeHandles={selfHandle ? [selfHandle] : []}
            disabled={disabled}
            closeOnPick={false}
            labels={{
              add: t('picker_add'),
              search: t('picker_search'),
              prompt: t('picker_prompt'),
              noMatch: t('picker_no_match'),
              remove: (name) => t('picker_remove', { name }),
            }}
          />
          <p className="mt-2 text-[11px] text-muted">
            {audience.length === 0 ? t('members_empty_hint') : t('members_hint')}
          </p>
        </div>
      )}
    </div>
  );
}
