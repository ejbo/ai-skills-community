import { beforeEach, describe, expect, it, vi } from 'vitest';

// The block cache is the only DB touch point of the engine — an in-memory stand-in.
const store = new Map<string, string>();
vi.mock('@/lib/translate/cache', async () => {
  const { createHash } = await import('node:crypto');
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
  const sourceHash = (t: string) => createHash('sha256').update(norm(t)).digest('hex');
  return {
    sourceHash,
    lookupBlocks: async (target: string, hashes: string[]) => {
      const out = new Map<string, string>();
      for (const h of hashes) if (store.has(`${target}:${h}`)) out.set(h, store.get(`${target}:${h}`)!);
      return out;
    },
    saveBlocks: async (target: string, _model: string, entries: { source: string; text: string }[]) => {
      for (const e of entries) store.set(`${target}:${sourceHash(e.source)}`, e.text);
    },
  };
});
// The validated env throws without a DATABASE_URL; the engine only reads two knobs from it.
vi.mock('@/lib/env', () => ({ env: { TRANSLATE_RUN_TIMEOUT_MS: 45_000, TRANSLATE_MAX_CONCURRENT: 8, TRANSLATE_ENABLED: true } }));
vi.mock('@/lib/translate/provider', () => ({
  getTranslationSlot: async () => {
    throw new Error('the tests inject `complete`; a slot must never be resolved');
  },
  translationConcurrency: () => 4,
  translationStatus: async () => ({ available: true, engine: 'test' }),
}));

import { checkReply } from '@/lib/translate/guards';
import { segment } from '@/lib/translate/markdown';
import { resetTranslateEngineState, translateUnits } from '@/lib/translate/engine';
import { translateItem } from '@/lib/translate/service';

/** A model that "translates" 中文 → English by tagging each passage, keeping markers. */
function fakeModel(map: (text: string, i: number) => string | null) {
  const calls: string[][] = [];
  const complete = async (_system: string, user: string) => {
    const items = (JSON.parse(user) as { items: { i: number; text: string }[] }).items;
    calls.push(items.map((x) => x.text));
    const out = items.map((x) => ({ i: x.i, text: map(x.text, x.i) })).filter((x) => x.text !== null);
    return JSON.stringify({ items: out });
  };
  return { complete, calls };
}
const english = (t: string) => `This is the English rendering of a passage that was ${t.length} characters long ${[...t.matchAll(/⟦\d+⟧/g)].map((m) => m[0]).join(' ')}`.trim();

beforeEach(() => {
  store.clear();
  resetTranslateEngineState();
});

describe('guards', () => {
  const unit = segment('我们把 `kv_cache` 的命中率提高到了九成，详见 [文档](/docs/a)。', 'md').units[0];
  const good = 'We raised the hit rate of ⟦0⟧ to ninety percent, see [the docs]⟦1⟧.';

  it('accepts a faithful reply and restores the slots', () => {
    const r = checkReply(unit, good, 'zh', 'en');
    expect(r).toEqual({ ok: true, text: 'We raised the hit rate of `kv_cache` to ninety percent, see [the docs](/docs/a).' });
  });
  it('strips a chatty prefix and wrapping quotes', () => {
    expect(checkReply(unit, `Translation: "${good}"`, 'zh', 'en')).toMatchObject({ ok: true });
  });
  it('rejects markup the model (or a prompt injection in the source) invented', () => {
    for (const evil of [
      `${good} [click here](https://evil.example)`,
      `${good} <img src=x onerror=alert(1)>`,
      `${good} see https://evil.example/login`,
      `${good} \`rm -rf\``,
      `${good}\n[embed:file:secret]`,
      `${good} ![x](/api/uploads/x.png)`,
    ]) {
      expect(checkReply(unit, evil, 'zh', 'en'), evil).toEqual({ ok: false, reason: 'markup' });
    }
  });
  it('rejects lost / duplicated placeholders', () => {
    expect(checkReply(unit, 'We raised the hit rate to ninety percent, see [the docs]⟦1⟧.', 'zh', 'en')).toEqual({ ok: false, reason: 'placeholder' });
  });
  it('rejects an echo and a reply in the wrong language', () => {
    expect(checkReply(unit, unit.protectedText, 'zh', 'en')).toMatchObject({ ok: false });
    expect(checkReply(unit, '我们把 ⟦0⟧ 的命中率提高了很多很多，详见 [文档]⟦1⟧ 这里。', 'zh', 'en')).toEqual({ ok: false, reason: 'language' });
  });
  it('rejects a runaway reply', () => {
    expect(checkReply(unit, `${good} ${'and then some more words '.repeat(40)}`, 'zh', 'en')).toEqual({ ok: false, reason: 'length' });
  });
  it('a title reply is collapsed to one line', () => {
    const title = segment('我们如何把首 token 延迟砍掉六成', 'title').units[0];
    expect(checkReply(title, 'How we cut first-token\nlatency by sixty percent', 'zh', 'en')).toEqual({ ok: true, text: 'How we cut first-token latency by sixty percent' });
  });
});

describe('engine', () => {
  const md = '第一段讲的是缓存命中率的问题。\n\n第二段讲的是延迟为什么会抖动。\n\n第一段讲的是缓存命中率的问题。';

  it('sends identical units once, caches, and serves the second reader without the model', async () => {
    const units = segment(md, 'md').units;
    expect(units).toHaveLength(3);
    const model = fakeModel(english);
    const first = await translateUnits({ target: 'en', sourceLang: 'zh', units, allowModel: true, complete: model.complete });
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]).toHaveLength(2); // the repeated paragraph went out once
    expect(first.done.size).toBe(3);
    expect(first.usedModel).toBe(true);

    const second = await translateUnits({ target: 'en', sourceLang: 'zh', units, allowModel: true, complete: model.complete });
    expect(model.calls).toHaveLength(1);
    expect(second.usedModel).toBe(false);
    expect(second.done.size).toBe(3);
    // …and a different target language is a different cache row
    const fr = await translateUnits({ target: 'fr', sourceLang: 'zh', units, allowModel: false });
    expect(fr.misses).toBe(3);
  });

  it('cache-only mode reports misses and never calls the model', async () => {
    const units = segment(md, 'md').units;
    const model = fakeModel(english);
    const r = await translateUnits({ target: 'en', sourceLang: 'zh', units, allowModel: false, complete: model.complete });
    expect(r).toMatchObject({ misses: 3, usedModel: false });
    expect(model.calls).toHaveLength(0);
  });

  it('concurrent readers of the same passage share ONE model call', async () => {
    const units = segment('只有一段，但是二十个人同时点了翻译。', 'md').units;
    let calls = 0;
    const slow = async (_s: string, user: string) => {
      calls++;
      await new Promise((r) => setTimeout(r, 30));
      const items = (JSON.parse(user) as { items: { i: number; text: string }[] }).items;
      return JSON.stringify({ items: items.map((x) => ({ i: x.i, text: english(x.text) })) });
    };
    const results = await Promise.all(Array.from({ length: 20 }, () => translateUnits({ target: 'en', sourceLang: 'zh', units, allowModel: true, complete: slow })));
    expect(calls).toBe(1);
    expect(results.every((r) => r.done.size === 1)).toBe(true);
  });

  it('a unit the model cannot do is retried once, then kept original and remembered', async () => {
    const units = segment('这一段模型总是翻不好，每次都丢掉占位符 `x`。\n\n这一段没有问题，可以正常翻译。', 'md').units;
    const model = fakeModel((t) => (t.includes('⟦') ? 'The marker was dropped by this careless model, sorry about that.' : english(t)));
    const r = await translateUnits({ target: 'en', sourceLang: 'zh', units, allowModel: true, complete: model.complete });
    expect(r.done.size).toBe(1);
    expect(r.failed).toBe(1);
    expect(model.calls).toHaveLength(2); // the batch + one retry of the failed unit
    const again = await translateUnits({ target: 'en', sourceLang: 'zh', units, allowModel: true, complete: model.complete });
    expect(model.calls).toHaveLength(2); // negative-cached: not re-attempted on the next view
    expect(again.done.size).toBe(1);
  });

  it('a model that is down fails the units without throwing', async () => {
    const units = segment(md, 'md').units;
    const r = await translateUnits({
      target: 'en',
      sourceLang: 'zh',
      units,
      allowModel: true,
      complete: async () => {
        throw new Error('fetch failed');
      },
    });
    expect(r.done.size).toBe(0);
    expect(r.failed).toBe(3);
  });
});

describe('service', () => {
  const body = ['## 背景', '', '我们的首 token 延迟一直偏高，用户抱怨了很久。', '', '[embed:library:kv-cache]', '', '- 第一步是测量', '- 第二步是优化', '', '```ts', 'const 不翻译 = true;', '```'].join('\n');
  const loader = async (id: string) => (id === 'p1' ? { title: '我们如何把延迟砍掉六成', body } : null);

  it('gates through the loader', async () => {
    expect(await translateItem({ kind: 'topic', id: 'nope', viewer: null, target: 'en', allowModel: true, loader })).toEqual({ status: 'error', error: 'not_found' });
  });
  it('same language ⇒ nothing to do; nothing translatable ⇒ nothing', async () => {
    expect(await translateItem({ kind: 'topic', id: 'p1', viewer: null, target: 'zh', allowModel: true, loader })).toEqual({ status: 'same', sourceLang: 'zh' });
    const emoji = async () => ({ body: '👍👍 https://a.b/c' });
    expect(await translateItem({ kind: 'post', id: 'x', viewer: null, target: 'en', allowModel: true, loader: emoji })).toEqual({ status: 'nothing' });
  });
  it('cache-only pass answers pending, the model pass translates title + body and keeps structure', async () => {
    const model = fakeModel(english);
    expect(await translateItem({ kind: 'topic', id: 'p1', viewer: null, target: 'en', allowModel: false, loader, complete: model.complete })).toEqual({ status: 'pending' });
    const r = await translateItem({ kind: 'topic', id: 'p1', viewer: null, target: 'en', allowModel: true, loader, complete: model.complete });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.state).toBe('ready');
    expect(r.sourceLang).toBe('zh');
    expect(r.fields.title).toMatch(/^This is the English/);
    expect(r.fields.body).toContain('## This is the English');
    expect(r.fields.body).toContain('\n[embed:library:kv-cache]\n');
    expect(r.fields.body).toContain('- This is the English');
    expect(r.fields.body).toContain('```ts\nconst 不翻译 = true;\n```');
    // second reader: pure cache
    const again = await translateItem({ kind: 'topic', id: 'p1', viewer: null, target: 'en', allowModel: false, loader });
    expect(again).toMatchObject({ status: 'ok', cached: true });
  });
  it('too long ⇒ a clean error, no model call', async () => {
    const huge = async () => ({ body: '很长的一段话。'.repeat(5000) });
    expect(await translateItem({ kind: 'post', id: 'x', viewer: null, target: 'en', allowModel: true, loader: huge })).toEqual({ status: 'error', error: 'translate_too_long' });
  });
  it('a fully failed translation is an error, a half failed one is partial', async () => {
    const none = fakeModel(() => null);
    expect(await translateItem({ kind: 'topic', id: 'p1', viewer: null, target: 'en', allowModel: true, loader, complete: none.complete })).toMatchObject({ status: 'error', error: 'translate_failed' });
    resetTranslateEngineState();
    const half = fakeModel((t) => (t.includes('第一步') ? null : english(t)));
    const r = await translateItem({ kind: 'topic', id: 'p1', viewer: null, target: 'en', allowModel: true, loader, complete: half.complete });
    expect(r).toMatchObject({ status: 'ok', state: 'partial' });
    if (r.status === 'ok') expect(r.fields.body).toContain('- 第一步是测量');
  });
});
