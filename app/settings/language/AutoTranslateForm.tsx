'use client';

// 设置 → 语言 → 内容翻译. The two choices the owner asked for — 总是看到译文 vs 看原文
// (需要时再翻译) — plus 「不需要翻译的语言」. It reads and writes the SAME context every
// <Translatable/> on the site subscribes to (components/translate/TranslatePrefs),
// so there is one source of truth and the change applies without a reload. Account
// settings (they follow the member across devices), optimistic with rollback.

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import { useTranslatePrefs } from '@/components/translate/TranslatePrefs';
import { CONTENT_LANGS, type ContentLang } from '@/lib/translate/shared';

const NATIVE_NAME: Record<ContentLang, string> = { zh: '中文', en: 'English', fr: 'Français' };

export function AutoTranslateForm() {
  const t = useTranslations('translate');
  const prefs = useTranslatePrefs();

  async function choose(auto: boolean) {
    if (auto === prefs.autoTranslate) return;
    const ok = await prefs.setAutoTranslate(auto);
    pushToast(ok ? 'success' : 'error', ok ? t('saved') : t('save_failed'));
  }

  async function toggleSkip(lang: ContentLang, skip: boolean) {
    const ok = await prefs.setSkipLang(lang, skip);
    pushToast(ok ? 'success' : 'error', ok ? t('saved') : t('save_failed'));
  }

  const modes = [
    { auto: false, title: t('mode_manual_title'), desc: t('mode_manual_desc') },
    { auto: true, title: t('mode_auto_title'), desc: t('mode_auto_desc') },
  ];

  return (
    <div className="space-y-4">
      {!prefs.available && (
        <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-xs leading-relaxed text-muted dark:border-zinc-700">{t('unavailable_note')}</p>
      )}

      <div className="surface divide-y divide-zinc-100 rounded-2xl dark:divide-zinc-800/60" role="radiogroup" aria-label={t('settings_title')}>
        {modes.map((m) => {
          const active = prefs.autoTranslate === m.auto;
          return (
            <button
              key={String(m.auto)}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => void choose(m.auto)}
              className="flex w-full items-start justify-between gap-4 px-5 py-3.5 text-left transition first:rounded-t-2xl last:rounded-b-2xl hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">{m.title}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted">{m.desc}</span>
              </span>
              <span
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                  active ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-300 dark:border-zinc-700'
                }`}
                aria-hidden
              >
                {active && <Check className="h-3 w-3" />}
              </span>
            </button>
          );
        })}
      </div>

      <div>
        <h3 className="text-sm font-semibold">{t('skip_title')}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">{t('skip_desc')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {CONTENT_LANGS.filter((l) => l !== prefs.viewerLang).map((lang) => {
            const on = prefs.skipLangs.includes(lang);
            return (
              <button
                key={lang}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => void toggleSkip(lang, !on)}
                className={`inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm transition ${
                  on
                    ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                    : 'border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600'
                }`}
              >
                {on && <Check className="h-3.5 w-3.5" aria-hidden />}
                {NATIVE_NAME[lang]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
