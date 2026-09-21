// 站内翻译 — one item, end to end: load (the loader IS the read gate) → detect →
// segment every field → engine → assemble. SERVER-ONLY.
//
// `allowModel: false` is the cache-only pass the route runs FIRST: a full hit is
// answered before authentication of the model budget, before the rate limiter and
// before a provider is even resolved — so the second reader of anything, in any
// language, costs one indexed query. Misses come back as `pending`; the route then
// decides whether this viewer may spend a model call and asks again.

import { detectContentLang, hasTranslatableText } from './detect';
import { translateUnits, type CompleteFn } from './engine';
import { assemble, segment, type Segmented, type Unit } from './markdown';
import { translationStatus } from './provider';
import type { SourceFields, TranslateLoader, TranslateViewer } from './source-types';
import {
  MAX_ITEM_CHARS,
  TRANSLATE_KINDS,
  type ContentLang,
  type FieldFormat,
  type FieldName,
  type TranslateKind,
  type TranslateOutcome,
} from './shared';

export interface TranslateItemInput {
  kind: TranslateKind;
  id: string;
  viewer: TranslateViewer;
  target: ContentLang;
  allowModel: boolean;
  /** Test seams. */
  loader?: TranslateLoader;
  complete?: CompleteFn;
}

export type TranslateItemResult = TranslateOutcome & { usedModel?: boolean };

const FIELD_ORDER: FieldName[] = ['title', 'summary', 'body'];

async function loaderFor(kind: TranslateKind): Promise<TranslateLoader> {
  // Imported lazily: the registry pulls in every domain's query layer, and the pure
  // parts of this module are exercised by tests that never touch a database.
  const { TRANSLATE_SOURCES } = await import('./sources');
  return TRANSLATE_SOURCES[kind];
}

export async function translateItem(input: TranslateItemInput): Promise<TranslateItemResult> {
  const spec = TRANSLATE_KINDS[input.kind];
  const load = input.loader ?? (await loaderFor(input.kind));
  const loaded = await load(input.id, input.viewer);
  if (!loaded) return { status: 'error', error: 'not_found' };

  // Only the fields this kind declares, in a fixed order, non-empty.
  const fields: { name: FieldName; format: FieldFormat; text: string }[] = [];
  for (const name of FIELD_ORDER) {
    const format = (spec.fields as Partial<Record<FieldName, FieldFormat>>)[name];
    const text = (loaded as SourceFields)[name];
    if (format && typeof text === 'string' && text.trim()) fields.push({ name, format, text });
  }
  const all = fields.map((f) => f.text).join('\n\n');
  if (fields.length === 0 || !hasTranslatableText(all)) return { status: 'nothing' };
  if (all.length > MAX_ITEM_CHARS) return { status: 'error', error: 'translate_too_long' };

  // The BODY decides the language when there is one (a 中文 post may carry an English title).
  const sourceLang = detectContentLang(fields.find((f) => f.name === 'body')?.text ?? all) ?? detectContentLang(all);
  if (sourceLang === input.target) return { status: 'same', sourceLang };

  // Flatten every field's units into one engine call, remembering where each came from.
  const segs = new Map<FieldName, Segmented>();
  const flat: Unit[] = [];
  const origin: { field: FieldName; local: number }[] = [];
  for (const f of fields) {
    const seg = segment(f.text, f.format);
    segs.set(f.name, seg);
    for (const u of seg.units) {
      origin.push({ field: f.name, local: u.index });
      flat.push({ ...u, index: flat.length });
    }
  }
  if (flat.length === 0) return { status: 'nothing' };

  const result = await translateUnits({
    target: input.target,
    sourceLang,
    units: flat,
    allowModel: input.allowModel,
    complete: input.complete,
  });
  if (!input.allowModel && result.misses > 0) return { status: 'pending' };
  if (result.done.size === 0) return { status: 'error', error: 'translate_failed', usedModel: result.usedModel };

  const perField = new Map<FieldName, Map<number, string>>();
  for (const [flatIndex, text] of result.done) {
    const o = origin[flatIndex];
    if (!perField.has(o.field)) perField.set(o.field, new Map());
    perField.get(o.field)!.set(o.local, text);
  }
  const out: Partial<Record<FieldName, string>> = {};
  let covered = 0;
  let total = 0;
  for (const f of fields) {
    const built = assemble(segs.get(f.name)!, perField.get(f.name) ?? new Map());
    out[f.name] = built.text;
    covered += built.covered;
    total += built.total;
  }
  return {
    status: 'ok',
    cached: !result.usedModel,
    usedModel: result.usedModel,
    target: input.target,
    sourceLang,
    fields: out,
    state: covered >= total ? 'ready' : 'partial',
    // A full cache hit never resolved a slot — name the engine that is serving now (60 s cached, never throws).
    engine: result.engine ?? (input.complete ? 'test' : ((await translationStatus()).engine ?? '')),
  };
}
