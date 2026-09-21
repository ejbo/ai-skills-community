'use client';

// 站内翻译 — viewer preferences as context. Seeded SERVER-side by app/layout.tsx
// ({ available, engine, viewerLang, signedIn, autoTranslate, skipLangs }), so no
// per-item fetch decides whether a 翻译 link renders, and an unconfigured box
// (available:false) renders none at all — a capability flag, not a dead button.
//
// 自动翻译 and 「不翻译此语言」 are ACCOUNT settings (PUT /api/settings/translation):
// optimistic here, rolled back on failure; every mounted <Translatable/> reacts at
// once — adding 「不翻译 English」 from one comment's gear hides the link everywhere.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { sanitizeSkipLangs, type ContentLang, type TranslatePrefsData } from '@/lib/translate/shared';

export interface TranslatePrefsValue extends TranslatePrefsData {
  setAutoTranslate: (on: boolean) => Promise<boolean>;
  setSkipLang: (lang: ContentLang, skip: boolean) => Promise<boolean>;
  /** The engine answered 503: hide every link for the rest of this page's life. */
  markUnavailable: () => void;
}

const FALLBACK: TranslatePrefsValue = {
  available: false,
  engine: null,
  viewerLang: 'zh',
  signedIn: false,
  autoTranslate: false,
  skipLangs: [],
  setAutoTranslate: async () => false,
  setSkipLang: async () => false,
  markUnavailable: () => undefined,
};

const Ctx = createContext<TranslatePrefsValue>(FALLBACK);

async function save(body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch('/api/settings/translation', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function TranslatePrefsProvider({ initial, children }: { initial: TranslatePrefsData; children: ReactNode }) {
  const [prefs, setPrefs] = useState<TranslatePrefsData>(initial);

  const setAutoTranslate = useCallback(async (on: boolean) => {
    let before = false;
    setPrefs((p) => {
      before = p.autoTranslate;
      return { ...p, autoTranslate: on };
    });
    const ok = await save({ autoTranslate: on });
    if (!ok) setPrefs((p) => ({ ...p, autoTranslate: before }));
    return ok;
  }, []);

  const setSkipLang = useCallback(async (lang: ContentLang, skip: boolean) => {
    let before: ContentLang[] = [];
    let next: ContentLang[] = [];
    setPrefs((p) => {
      before = p.skipLangs;
      next = sanitizeSkipLangs(skip ? [...p.skipLangs, lang] : p.skipLangs.filter((l) => l !== lang));
      return { ...p, skipLangs: next };
    });
    const ok = await save({ translateSkipLangs: next });
    if (!ok) setPrefs((p) => ({ ...p, skipLangs: before }));
    return ok;
  }, []);

  const markUnavailable = useCallback(() => setPrefs((p) => (p.available ? { ...p, available: false } : p)), []);

  const value = useMemo(() => ({ ...prefs, setAutoTranslate, setSkipLang, markUnavailable }), [prefs, setAutoTranslate, setSkipLang, markUnavailable]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTranslatePrefs(): TranslatePrefsValue {
  return useContext(Ctx);
}
