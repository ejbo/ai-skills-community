// 站内翻译 — the browser-side request layer. Plain module (no React): one result
// cache, one in-flight gate and one batch coalescer shared by every
// <Translatable/> on the page.
//
//   requestTranslation   a click, or an auto-mode item the batch reported `pending`:
//                        POST /api/translate, at most SINGLE_PARALLEL in flight
//                        (each may hold a model call; a feed of forty foreign posts
//                        must not open forty), identical asks share one promise.
//   requestCached        自动翻译: items that scrolled into view within COALESCE_MS
//                        are sent as ONE POST /api/translate/batch — cache-only on
//                        the server, so it is cheap and needs no model budget.
//
// Results are cached per `kind:id:target:hash(text)` for the life of the page — a
// re-mounted feed card or a reopened drawer never refetches, and an in-place edit
// (new text ⇒ new hash) can never show the old translation.

import { fnv1a, translateItemKey, type ContentLang, type TranslateKind, type TranslateOutcome } from '@/lib/translate/shared';

const SINGLE_PARALLEL = 3;
const COALESCE_MS = 150;
const BATCH_MAX = 30;

export interface TranslateAsk {
  kind: TranslateKind;
  id: string;
  target: ContentLang;
  /** All of the item's text, joined — only hashed, never sent. */
  text: string;
}

const results = new Map<string, TranslateOutcome>();
const singles = new Map<string, Promise<TranslateOutcome>>();

export function resultKey(ask: TranslateAsk): string {
  return `${translateItemKey(ask.kind, ask.id)}:${ask.target}:${fnv1a(ask.text)}`;
}

/** A settled answer from earlier on this page, if any (`pending` is never stored). */
export function peekTranslation(ask: TranslateAsk): TranslateOutcome | undefined {
  return results.get(resultKey(ask));
}

function remember(key: string, outcome: TranslateOutcome): void {
  // Only answers that stay true: a transient failure must be retryable.
  if (outcome.status === 'ok' || outcome.status === 'same' || outcome.status === 'nothing') results.set(key, outcome);
}

// ── single requests, gated ───────────────────────────────────────────────────

let running = 0;
const queue: (() => void)[] = [];

function gate<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      running++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          running--;
          queue.shift()?.();
        });
    };
    if (running < SINGLE_PARALLEL) run();
    else queue.push(run);
  });
}

export function requestTranslation(ask: TranslateAsk): Promise<TranslateOutcome> {
  const key = resultKey(ask);
  const known = results.get(key);
  if (known) return Promise.resolve(known);
  const pending = singles.get(key);
  if (pending) return pending;
  const p = gate(async (): Promise<TranslateOutcome> => {
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: ask.kind, id: ask.id, target: ask.target }),
      });
      const data = (await res.json().catch(() => null)) as TranslateOutcome | null;
      if (data && typeof data === 'object' && 'status' in data) return data;
      return { status: 'error', error: res.status === 401 ? 'unauthenticated' : 'translate_failed' };
    } catch {
      return { status: 'error', error: 'translate_failed' };
    }
  }).then((outcome) => {
    remember(key, outcome);
    return outcome;
  });
  singles.set(key, p);
  void p.finally(() => singles.delete(key));
  return p;
}

// ── batched cache lookups (auto mode) ────────────────────────────────────────

interface Waiting {
  ask: TranslateAsk;
  resolve: (o: TranslateOutcome) => void;
}
let waiting: Waiting[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  timer = null;
  const all = waiting;
  waiting = [];
  // One request per target language (a page has one, but the key is honest about it).
  const byTarget = new Map<ContentLang, Waiting[]>();
  for (const w of all) byTarget.set(w.ask.target, [...(byTarget.get(w.ask.target) ?? []), w]);
  for (const [target, group] of byTarget) {
    for (let i = 0; i < group.length; i += BATCH_MAX) {
      const slice = group.slice(i, i + BATCH_MAX);
      let answers: Record<string, TranslateOutcome> = {};
      try {
        const res = await fetch('/api/translate/batch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ target, items: slice.map((w) => ({ kind: w.ask.kind, id: w.ask.id })) }),
        });
        if (res.ok) answers = ((await res.json()) as { results?: Record<string, TranslateOutcome> }).results ?? {};
      } catch {
        /* every item below resolves to an error and stays retryable */
      }
      for (const w of slice) {
        const outcome = answers[translateItemKey(w.ask.kind, w.ask.id)] ?? { status: 'error', error: 'translate_failed' };
        remember(resultKey(w.ask), outcome);
        w.resolve(outcome);
      }
    }
  }
}

/** Cache-only lookup, coalesced with everything else that asked in the same 150 ms. May answer `pending`. */
export function requestCached(ask: TranslateAsk): Promise<TranslateOutcome> {
  const known = results.get(resultKey(ask));
  if (known) return Promise.resolve(known);
  return new Promise<TranslateOutcome>((resolve) => {
    waiting.push({ ask, resolve });
    if (!timer) timer = setTimeout(() => void flush(), COALESCE_MS);
  });
}
