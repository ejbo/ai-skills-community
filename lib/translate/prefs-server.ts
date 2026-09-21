// 站内翻译 — what app/layout.tsx seeds into <TranslatePrefsProvider/>. SERVER-ONLY.
// Runs on every document render, so it must never throw and never be slow: the
// engine status is 60 s cached, and a signed-in viewer costs ONE two-column read.
// Any failure (columns not migrated yet, DB blip) degrades to "manual, nothing
// skipped" — the page still renders and the 翻译 link still works.

import { prisma } from '@/lib/db';
import { translationStatus } from './provider';
import { sanitizeSkipLangs, viewerLang, type TranslatePrefsData } from './shared';

export async function loadTranslatePrefs(userId: string | null | undefined, locale: string): Promise<TranslatePrefsData> {
  const [status, row] = await Promise.all([
    translationStatus(),
    userId
      ? prisma.user
          .findUnique({ where: { id: userId }, select: { autoTranslate: true, translateSkipLangs: true } })
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  return {
    available: status.available,
    engine: status.engine,
    viewerLang: viewerLang(locale),
    signedIn: Boolean(userId),
    autoTranslate: row?.autoTranslate ?? false,
    skipLangs: sanitizeSkipLangs(row?.translateSkipLangs),
  };
}
