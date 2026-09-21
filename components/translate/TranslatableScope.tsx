'use client';

// <Translatable/> for SERVER-rendered pages. A Server Component cannot hand a
// render-prop (a function) to a Client Component, so a detail page uses this scope
// instead: ONE translation state for the item, read by small client leaves placed
// wherever the page needs them — the h1, the summary, the body renderer, the
// action row. `children` stays server-rendered markup; only the leaves hydrate.
//
//   // in an RSC page
//   <TranslatableScope kind="zone_post" id={post.id} fields={{ title, summary, body }}>
//     <h1><TranslatedText field="title" /></h1>
//     …server-rendered byline…
//     <TranslateNote />
//     <PostBodyClient />          ← a client leaf: useTranslated().body → <ZoneMarkdown content=… />
//     <TranslateControl />
//   </TranslatableScope>
//
// One toggle flips every field together (X translates the post, not its parts).
// There is no container to observe here, so 自动翻译 runs as soon as the page
// mounts — on a detail page the item IS the page.

import { createContext, useContext, type ReactNode } from 'react';
import type { FieldName, TranslateKind } from '@/lib/translate/shared';
import { Translatable, type TranslatableRender, type TranslateTone } from './Translatable';

const Ctx = createContext<TranslatableRender | null>(null);

export function TranslatableScope({
  kind,
  id,
  fields,
  tone,
  disabled,
  children,
}: {
  kind: TranslateKind;
  id: string;
  fields: Partial<Record<FieldName, string | null | undefined>>;
  tone?: TranslateTone;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Translatable kind={kind} id={id} fields={fields} tone={tone} disabled={disabled}>
      {(t) => <Ctx.Provider value={t}>{children}</Ctx.Provider>}
    </Translatable>
  );
}

/** The scope's current render state; null outside a scope (leaves then render their fallback / nothing). */
export function useTranslated(): TranslatableRender | null {
  return useContext(Ctx);
}

/** The field's current text — the translation while it is showing, else the original (`fallback` outside a scope). */
export function TranslatedText({ field, fallback = '' }: { field: FieldName; fallback?: string }) {
  const t = useContext(Ctx);
  return <>{t ? t[field] || fallback : fallback}</>;
}

/** 翻译 / 翻译中… / 显示译文. Renders nothing when there is nothing to offer. */
export function TranslateControl({ className }: { className?: string }) {
  const t = useContext(Ctx);
  if (!t?.control) return null;
  return className ? <div className={className}>{t.control}</div> : <>{t.control}</>;
}

/** 「译自{lang} · {engine} · 显示原文 · ⚙」 — only while the translation is showing. */
export function TranslateNote({ className }: { className?: string }) {
  const t = useContext(Ctx);
  if (!t?.note) return null;
  return className ? <div className={className}>{t.note}</div> : <>{t.note}</>;
}
