'use client';

// 反馈正文 — a client leaf so the RSC detail page can take part in 站内翻译: it renders
// the SAME <MarkdownRenderer/> the page used to call directly, fed with whatever the
// page's <TranslatableScope kind="feedback"> currently shows (the translation while
// it is showing, else the original). Outside a scope it renders `bodyMd` as before.

import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useTranslated } from '@/components/translate/TranslatableScope';

export function FeedbackBody({ bodyMd }: { bodyMd: string }) {
  const tr = useTranslated();
  return <MarkdownRenderer content={tr?.body || bodyMd} />;
}
