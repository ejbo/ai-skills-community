import { describe, expect, it } from 'vitest';
import { canonicalizeUrl } from '@/lib/library/canonical-url';

describe('canonicalizeUrl', () => {
  it('auto-prefixes https:// when the scheme is missing', () => {
    expect(canonicalizeUrl('example.com/posts/1')).toBe('https://example.com/posts/1');
    expect(canonicalizeUrl('  example.com  ')).toBe('https://example.com/');
    expect(canonicalizeUrl('//example.com/a')).toBe('https://example.com/a');
  });

  it('keeps http and https as-is', () => {
    expect(canonicalizeUrl('http://example.com/a')).toBe('http://example.com/a');
    expect(canonicalizeUrl('https://example.com/a')).toBe('https://example.com/a');
  });

  it('rejects non-web schemes and garbage', () => {
    expect(canonicalizeUrl('mailto:someone@example.com')).toBeNull();
    expect(canonicalizeUrl('javascript:alert(1)')).toBeNull();
    expect(canonicalizeUrl('ftp://example.com/file')).toBeNull();
    expect(canonicalizeUrl('customapp://open/page')).toBeNull();
    expect(canonicalizeUrl('')).toBeNull();
    expect(canonicalizeUrl('   ')).toBeNull();
    expect(canonicalizeUrl('http://')).toBeNull();
  });

  it('lowercases the host but preserves path case', () => {
    expect(canonicalizeUrl('https://EXAMPLE.Com/Some/Path')).toBe('https://example.com/Some/Path');
  });

  it('strips the fragment', () => {
    expect(canonicalizeUrl('https://example.com/a#section-2')).toBe('https://example.com/a');
    expect(canonicalizeUrl('https://example.com/#top')).toBe('https://example.com/');
  });

  it('drops utm_* and known tracking params but keeps meaningful ones', () => {
    expect(
      canonicalizeUrl('https://example.com/a?utm_source=wx&utm_medium=social&id=42&page=2'),
    ).toBe('https://example.com/a?id=42&page=2');
    expect(canonicalizeUrl('https://example.com/a?fbclid=xyz&gclid=abc&spm=1.2.3')).toBe(
      'https://example.com/a',
    );
    expect(canonicalizeUrl('https://example.com/a?ref=hn&ref_src=tw&from=timeline&q=llm')).toBe(
      'https://example.com/a?q=llm',
    );
    expect(canonicalizeUrl('https://example.com/a?igshid=1&share_token=t&isappinstalled=0')).toBe(
      'https://example.com/a',
    );
  });

  it('strips the trailing slash on non-root paths only', () => {
    expect(canonicalizeUrl('https://example.com/a/b/')).toBe('https://example.com/a/b');
    expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/');
    expect(canonicalizeUrl('https://example.com')).toBe('https://example.com/');
  });

  it('produces a stable canonical form for equivalent inputs (dedup anchor)', () => {
    const a = canonicalizeUrl('HTTPS://Example.com/Post/?utm_source=x#frag');
    const b = canonicalizeUrl('example.com/Post/');
    expect(a).toBe('https://example.com/Post');
    expect(a).toBe(b);
  });

  it('tolerates host:port without a scheme', () => {
    expect(canonicalizeUrl('example.com:8080/a')).toBe('https://example.com:8080/a');
  });
});
