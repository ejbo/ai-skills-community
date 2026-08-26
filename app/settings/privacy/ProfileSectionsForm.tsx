'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';

export type ProfileSectionFlags = {
  showProfileSkills: boolean;
  showProfileDocs: boolean;
  showProfilePosts: boolean;
  showProfileComments: boolean;
  showProfileShelf: boolean;
  showProfileEvents: boolean;
};

const SECTION_KEYS: { field: keyof ProfileSectionFlags; labelKey: string; descKey: string }[] = [
  { field: 'showProfileSkills', labelKey: 'profile_sections_skills', descKey: 'profile_sections_skills_desc' },
  { field: 'showProfileDocs', labelKey: 'profile_sections_docs', descKey: 'profile_sections_docs_desc' },
  { field: 'showProfilePosts', labelKey: 'profile_sections_posts', descKey: 'profile_sections_posts_desc' },
  { field: 'showProfileComments', labelKey: 'profile_sections_comments', descKey: 'profile_sections_comments_desc' },
  { field: 'showProfileShelf', labelKey: 'profile_sections_shelf', descKey: 'profile_sections_shelf_desc' },
  { field: 'showProfileEvents', labelKey: 'profile_sections_events', descKey: 'profile_sections_events_desc' },
];

/** 个人主页板块可见性 — which /users/[handle] sections other users can see. */
export function ProfileSectionsForm({ initial }: { initial: ProfileSectionFlags }) {
  const t = useTranslations('settings');
  const [flags, setFlags] = useState(initial);
  const [saving, setSaving] = useState<keyof ProfileSectionFlags | null>(null);

  async function toggle(field: keyof ProfileSectionFlags) {
    const next = !flags[field];
    setFlags((f) => ({ ...f, [field]: next }));
    setSaving(field);
    try {
      const res = await fetch('/api/settings/privacy', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [field]: next }),
      });
      if (!res.ok) throw new Error();
      pushToast('success', t('saved'));
    } catch {
      setFlags((f) => ({ ...f, [field]: !next }));
      pushToast('error', t('save_failed'));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      <h3 className="text-sm font-medium">{t('profile_sections_title')}</h3>
      <p className="mt-1 max-w-lg text-xs leading-relaxed text-muted">
        {t('profile_sections_desc')}
      </p>
      <div className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
        {SECTION_KEYS.map(({ field, labelKey, descKey }) => (
          <div key={field} className="flex items-start justify-between gap-6 py-3 first:pt-0 last:pb-0">
            <div>
              <p className="text-sm">{t(labelKey)}</p>
              <p className="mt-0.5 max-w-lg text-xs text-muted">{t(descKey)}</p>
            </div>
            <button
              role="switch"
              aria-checked={flags[field]}
              aria-label={t(labelKey)}
              disabled={saving === field}
              onClick={() => toggle(field)}
              className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${
                flags[field] ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-300 dark:bg-zinc-700'
              } disabled:opacity-60`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  flags[field] ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
