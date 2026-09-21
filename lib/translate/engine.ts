// 站内翻译 — the engine: units in, restored translations out.
//   cache → (in-flight dedupe) → model under a translation-only semaphore →
//   stripReasoning → guards → one retry → cache write.
// SERVER-ONLY. A unit that cannot be translated is simply absent from the result:
// the caller keeps its original text and reports the item `partial`. Nothing here
// throws for a bad reply — only for "there is no engine at all" (LLMConfigError),
// which the route turns into 503 and the client into a hidden link.
//
// Cost discipline (a reader is waiting on a text link, and the GPU is shared):
//   · identical units inside one request are sent once; identical units across
//     CONCURRENT requests share one call (`inflight`) — a fresh hot post opened by
//     twenty auto-translate readers is one translation, not twenty;
//   · a unit that failed its guards twice is remembered for NEGATIVE_TTL_MS, so a
//     passage some model cannot handle is not re-attempted on every page view;
//   · translation holds at most `translationConcurrency(slot)` model calls (2 on
//     the 知识库 fallback), so a burst of 翻译 clicks cannot starve 知识库 chat;
//   · every call has its own deadline (TRANSLATE_RUN_TIMEOUT_MS), never the
//     inherited 300 s, and an item stops launching calls past ITEM_BUDGET_MS.

import { env } from '@/lib/env';
import { parseTranslatedPassages } from '@/lib/library/ai-prompts';
import { stripReasoning } from '@/lib/skill-assist';
import { lookupBlocks, saveBlocks, sourceHash } from './cache';
import { checkReply, type GuardReason } from './guards';
import type { Unit } from './markdown';
import { GENERAL_BATCH, generalPrompt, mtPrompt } from './prompts';
import { getTranslationSlot, translationConcurrency, type TranslationSlot } from './provider';
import type { ContentLang } from './shared';

const NEGATIVE_TTL_MS = 30 * 60_000;
const NEGATIVE_MAX = 5000;
/** Past this an item returns what it has (`partial`); a re-click finishes the rest from cache. */
export const ITEM_BUDGET_MS = 50_000;

// ── translation-only semaphore ───────────────────────────────────────────────

let active = 0;
const waiters: (() => void)[] = [];

async function withPermit<T>(max: number, fn: () => Promise<T>): Promise<T> {
  if (active >= max) await new Promise<void>((resolve) => waiters.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}

// ── cross-request state ──────────────────────────────────────────────────────

/** `${target}:${hash}` → the translation being produced right now (null = it failed). */
const inflight = new Map<string, Promise<string | null>>();
/** `${target}:${hash}` → when it last failed both attempts. */
const negative = new Map<string, number>();

function rememberFailure(key: string): void {
  if (negative.size >= NEGATIVE_MAX) {
    const oldest = negative.keys().next().value;
    if (oldest !== undefined) negative.delete(oldest);
  }
  negative.set(key, Date.now());
}

function recentlyFailed(key: string): boolean {
  const at = negative.get(key);
  if (at === undefined) return false;
  if (Date.now() - at > NEGATIVE_TTL_MS) {
    negative.delete(key);
    return false;
  }
  return true;
}

// ── counters (health / tests) ────────────────────────────────────────────────

export const translateCounters = {
  hits: 0,
  misses: 0,
  modelCalls: 0,
  guardFail: {} as Partial<Record<GuardReason | 'no_reply' | 'error', number>>,
};

function countFail(reason: GuardReason | 'no_reply' | 'error'): void {
  translateCounters.guardFail[reason] = (translateCounters.guardFail[reason] ?? 0) + 1;
}

// ── model calls ──────────────────────────────────────────────────────────────

/** Injectable for tests: (system, user, json) → raw reply text. */
export type CompleteFn = (system: string, user: string, json: boolean) => Promise<string>;

function completeWith(slot: TranslationSlot): CompleteFn {
  return async (system, user, json) => {
    translateCounters.modelCalls++;
    const res = await slot.provider.complete({
      system,
      messages: [{ role: 'user', content: user }],
      ...(json ? { json: true } : {}),
      // No maxTokens (house rule): a cap is what cuts a reasoning model off inside <think>.
      signal: AbortSignal.timeout(env.TRANSLATE_RUN_TIMEOUT_MS),
    });
    return res.text;
  };
}

interface Pending {
  unit: Unit;
  hash: string;
  resolve: (text: string | null) => void;
}

async function runGeneralBatch(batch: Pending[], ctx: RunCtx, strictRetry: boolean): Promise<Pending[]> {
  const failed: Pending[] = [];
  let parsed = new Map<number, string>();
  try {
    const prompt = generalPrompt(ctx.target, batch.map((p) => p.unit.protectedText));
    parsed = parseTranslatedPassages(await ctx.complete(prompt.system, prompt.user, true));
  } catch {
    countFail('error');
  }
  batch.forEach((p, i) => {
    const reply = parsed.get(i);
    if (reply === undefined) {
      countFail('no_reply');
      failed.push(p);
      return;
    }
    const verdict = checkReply(p.unit, reply, ctx.sourceLang, ctx.target);
    if (verdict.ok) ctx.accept(p, verdict.text);
    else {
      countFail(verdict.reason);
      failed.push(p);
    }
  });
  void strictRetry;
  return failed;
}

async function runMtUnit(p: Pending, ctx: RunCtx): Promise<boolean> {
  for (const strict of [false, true]) {
    try {
      const prompt = mtPrompt(ctx.target, p.unit.protectedText, strict);
      const raw = await ctx.complete(prompt.system, prompt.user, false);
      // A mis-pointed reasoning model on the mt slot must degrade to "kept original", never to leaked chain of thought.
      const answer = stripReasoning(raw);
      if (answer === null) {
        countFail('no_reply');
        continue;
      }
      const verdict = checkReply(p.unit, answer, ctx.sourceLang, ctx.target);
      if (verdict.ok) {
        ctx.accept(p, verdict.text);
        return true;
      }
      countFail(verdict.reason);
    } catch {
      countFail('error');
      return false; // a request FAILURE is not retried here — the next click is the retry
    }
  }
  return false;
}

interface RunCtx {
  target: ContentLang;
  sourceLang: ContentLang | null;
  complete: CompleteFn;
  accept: (p: Pending, text: string) => void;
}

export interface TranslateUnitsOptions {
  target: ContentLang;
  /** Detected language of the whole item (guards stand down on null). */
  sourceLang: ContentLang | null;
  units: Unit[];
  /** false ⇒ cache only (anonymous viewers, batch lookups): misses are reported, never translated. */
  allowModel: boolean;
  /** Test seam: replaces the provider call. When set, no slot is resolved. */
  complete?: CompleteFn;
  /** Test seam for the semaphore width / engine label. */
  slot?: Pick<TranslationSlot, 'kind' | 'model' | 'label' | 'isLibraryFallback'>;
}

export interface TranslateUnitsResult {
  /** unit.index → restored translation. Absent = keep the original. */
  done: Map<number, string>;
  /** Units that were NOT in the cache. With `allowModel: false` these are what a model call would be needed for. */
  misses: number;
  /** Misses the model could not translate (guards / errors / budget). */
  failed: number;
  /** Did this call reach the model? (the route charges the rate limit on true) */
  usedModel: boolean;
  engine: string | null;
}

/** How many units of `units` are not cached — the route uses it to decide whether a rate-limit charge is due. */
export async function countMisses(target: ContentLang, units: Unit[]): Promise<number> {
  const hashes = units.map((u) => sourceHash(u.source));
  const hit = await lookupBlocks(target, hashes);
  return new Set(hashes.filter((h) => !hit.has(h))).size;
}

export async function translateUnits(opts: TranslateUnitsOptions): Promise<TranslateUnitsResult> {
  const { target, units } = opts;
  const done = new Map<number, string>();
  if (units.length === 0) return { done, misses: 0, failed: 0, usedModel: false, engine: null };

  const hashOf = new Map<number, string>(units.map((u) => [u.index, sourceHash(u.source)]));
  const cached = await lookupBlocks(target, [...hashOf.values()]);
  const missing: Unit[] = [];
  for (const u of units) {
    const hit = cached.get(hashOf.get(u.index)!);
    if (hit !== undefined) done.set(u.index, hit);
    else missing.push(u);
  }
  translateCounters.hits += done.size;
  translateCounters.misses += missing.length;
  if (missing.length === 0 || !opts.allowModel) {
    return { done, misses: missing.length, failed: 0, usedModel: false, engine: null };
  }

  // Resolve the engine only now: a full cache hit must work even with no model configured.
  const slot = opts.slot ?? (opts.complete ? { kind: 'general' as const, model: 'test', label: 'test', isLibraryFallback: false } : await getTranslationSlot());
  const complete = opts.complete ?? completeWith(slot as TranslationSlot);
  const width = translationConcurrency(slot);
  const startedAt = Date.now();

  // One Pending per DISTINCT text; identical units share its answer.
  const byHash = new Map<string, Unit[]>();
  for (const u of missing) {
    const h = hashOf.get(u.index)!;
    byHash.set(h, [...(byHash.get(h) ?? []), u]);
  }

  const fresh: { source: string; text: string }[] = [];
  const waits: Promise<void>[] = [];
  const mine: Pending[] = [];
  let failed = 0;

  for (const [hash, same] of byHash) {
    const key = `${target}:${hash}`;
    const apply = (text: string | null) => {
      if (text === null) failed += same.length;
      else for (const u of same) done.set(u.index, text);
    };
    if (recentlyFailed(key)) {
      apply(null);
      continue;
    }
    const running = inflight.get(key);
    if (running) {
      waits.push(running.then(apply));
      continue;
    }
    let resolve!: (text: string | null) => void;
    const promise = new Promise<string | null>((r) => (resolve = r));
    inflight.set(key, promise);
    void promise.finally(() => inflight.delete(key));
    waits.push(promise.then(apply));
    mine.push({ unit: same[0], hash, resolve });
  }

  const settled = new Set<Pending>();
  const ctx: RunCtx = {
    target,
    sourceLang: opts.sourceLang,
    complete,
    accept: (p, text) => {
      if (settled.has(p)) return;
      settled.add(p);
      fresh.push({ source: p.unit.source, text });
      p.resolve(text);
    },
  };
  const giveUp = (p: Pending) => {
    if (settled.has(p)) return;
    settled.add(p);
    rememberFailure(`${target}:${p.hash}`);
    p.resolve(null);
  };
  const outOfBudget = () => Date.now() - startedAt > ITEM_BUDGET_MS;

  try {
    if (slot.kind === 'mt') {
      await Promise.all(
        mine.map((p) =>
          withPermit(width, async () => {
            if (outOfBudget()) return p.resolve(null); // not a failure of the text — do not remember it
            if (!(await runMtUnit(p, ctx))) giveUp(p);
          }),
        ),
      );
    } else {
      const batches: Pending[][] = [];
      for (let i = 0; i < mine.length; i += GENERAL_BATCH) batches.push(mine.slice(i, i + GENERAL_BATCH));
      const retry: Pending[] = [];
      await Promise.all(
        batches.map((batch) =>
          withPermit(width, async () => {
            if (outOfBudget()) return batch.forEach((p) => p.resolve(null));
            retry.push(...(await runGeneralBatch(batch, ctx, false)));
          }),
        ),
      );
      // One more chance for what failed — alone together, where a bad neighbour cannot spoil the JSON.
      for (let i = 0; i < retry.length; i += GENERAL_BATCH) {
        const batch = retry.slice(i, i + GENERAL_BATCH);
        if (outOfBudget()) {
          batch.forEach((p) => p.resolve(null));
          continue;
        }
        const still = await withPermit(width, () => runGeneralBatch(batch, ctx, true));
        still.forEach(giveUp);
      }
    }
  } finally {
    // Whatever happened, nobody may be left awaiting a promise that never settles.
    for (const p of mine) if (!settled.has(p)) p.resolve(null);
  }

  await Promise.all(waits);
  await saveBlocks(target, slot.model, fresh);
  return { done, misses: missing.length, failed, usedModel: true, engine: slot.label };
}

/** Test hook: forget cross-request state. */
export function resetTranslateEngineState(): void {
  inflight.clear();
  negative.clear();
  active = 0;
  waiters.length = 0;
}
