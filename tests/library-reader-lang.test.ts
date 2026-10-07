import { describe, expect, it } from 'vitest';
import {
  asTitleTranslations,
  pickDocTitle,
  prefForChoice,
  resolveReaderText,
  translatedTitle,
} from '@/lib/library/translation-shared';
import {
  chapterSourceHash,
  effectivePassState,
  isFreshChapterTranslation,
  passOrder,
  STALE_LOCK_MS,
} from '@/lib/library/translation-state';

describe('阅读语言 defaults (owner: 中文界面默认中文、英文界面默认英文)', () => {
  it('auto follows the UI language and shows 原文 when the doc is already in it', () => {
    expect(resolveReaderText('auto', 'zh-CN', 'en')).toBe('zh');
    expect(resolveReaderText('auto', 'en', 'zh')).toBe('en');
    expect(resolveReaderText('auto', 'zh-CN', 'zh')).toBe('original');
    expect(resolveReaderText('auto', 'en', 'en')).toBe('original');
    // fr reads the English twin, like the stored bilingual content
    expect(resolveReaderText('auto', 'fr', 'zh')).toBe('en');
    // a doc in neither language is translated into the reader's
    expect(resolveReaderText('auto', 'zh-CN', null)).toBe('zh');
  });

  it('honours an explicit 原文 or language pick', () => {
    expect(resolveReaderText('original', 'zh-CN', 'en')).toBe('original');
    expect(resolveReaderText('en', 'zh-CN', null)).toBe('en');
    expect(resolveReaderText('zh', 'en', 'zh')).toBe('original');
  });

  it('stores `auto` for a pick that equals the default, so the UI language keeps leading', () => {
    expect(prefForChoice('zh', 'zh-CN', 'en')).toBe('auto');
    expect(prefForChoice('original', 'zh-CN', 'en')).toBe('original');
    expect(prefForChoice('en', 'zh-CN', null)).toBe('en');
    expect(prefForChoice('original', 'zh-CN', 'zh')).toBe('auto');
  });
});

describe('translated titles', () => {
  const doc = {
    title: 'Attention Is All You Need',
    language: 'en',
    titleTranslations: { source: 'Attention Is All You Need', zh: '注意力就是你所需要的一切' },
  };

  it('shows the translation in the viewer language and the original otherwise', () => {
    expect(pickDocTitle('zh-CN', doc)).toBe('注意力就是你所需要的一切');
    expect(pickDocTitle('en', doc)).toBe('Attention Is All You Need');
    expect(pickDocTitle('fr', doc)).toBe('Attention Is All You Need');
  });

  it('self-invalidates when the title is edited', () => {
    expect(pickDocTitle('zh-CN', { ...doc, title: 'Attention (revised)' })).toBe('Attention (revised)');
    expect(translatedTitle('Attention (revised)', doc.titleTranslations, 'zh')).toBeNull();
  });

  it('rejects malformed JSON', () => {
    expect(asTitleTranslations(null)).toBeNull();
    expect(asTitleTranslations(['x'])).toBeNull();
    expect(asTitleTranslations({ zh: 'x' })).toBeNull();
    expect(asTitleTranslations({ source: 's', zh: '  ', en: 3 })).toEqual({ source: 's' });
  });
});

describe('pass bookkeeping', () => {
  it('starts at the reader\'s chapter and wraps around', () => {
    const ch = [0, 1, 2, 3, 4].map((chapterIndex) => ({ chapterIndex }));
    expect(passOrder(ch, 3).map((c) => c.chapterIndex)).toEqual([3, 4, 0, 1, 2]);
    expect(passOrder(ch, 0).map((c) => c.chapterIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(passOrder(ch).map((c) => c.chapterIndex)).toEqual([0, 1, 2, 3, 4]);
    // pending lists can have gaps — start at the first chapter at or after the reader
    const gaps = [0, 2, 5].map((chapterIndex) => ({ chapterIndex }));
    expect(passOrder(gaps, 3).map((c) => c.chapterIndex)).toEqual([5, 0, 2]);
  });

  it('a chapter translation is fresh only for the html it was built from (legacy rows stay visible)', () => {
    const html = '<p>hello</p>';
    expect(isFreshChapterTranslation({ sourceHash: chapterSourceHash(html) }, html)).toBe(true);
    expect(isFreshChapterTranslation({ sourceHash: chapterSourceHash(html) }, '<p>edited</p>')).toBe(false);
    expect(isFreshChapterTranslation({ sourceHash: 'legacy' }, '<p>anything</p>')).toBe(true);
  });

  it('a running pass with a dead heartbeat reads as never started', () => {
    expect(effectivePassState(null)).toBe('none');
    expect(effectivePassState({ state: 'running', heartbeatAt: new Date() })).toBe('running');
    expect(effectivePassState({ state: 'running', heartbeatAt: new Date(Date.now() - STALE_LOCK_MS - 1) })).toBe('none');
    expect(effectivePassState({ state: 'ready', heartbeatAt: new Date(0) })).toBe('ready');
  });
});
