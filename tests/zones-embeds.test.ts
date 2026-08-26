import { describe, expect, it } from 'vitest';
import { decodeHtmlEntities, normalizePreviewUrl, parseOgMeta, resolveImageUrl } from '@/lib/zones/og-parse';

const PAGE = 'https://example.com/articles/hello?x=1';

describe('parseOgMeta', () => {
  it('reads og:* tags regardless of attribute order and quoting', () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Hello &amp; Welcome" />
        <meta content='A short &quot;description&quot;' property='og:description'>
        <meta name="og:image" content="https://cdn.example.com/cover.jpg">
        <meta property=og:site_name content=Example>
        <title>Ignored title</title>
      </head><body></body></html>`;
    const meta = parseOgMeta(html, PAGE);
    expect(meta).toEqual({
      url: PAGE,
      title: 'Hello & Welcome',
      description: 'A short "description"',
      imageUrl: 'https://cdn.example.com/cover.jpg',
      siteName: 'Example',
    });
  });

  it('falls back to <title>, meta description and twitter:* tags', () => {
    const html = `
      <head>
        <title>
          Fallback   Title
        </title>
        <meta name="description" content="Plain description">
        <meta name="twitter:image" content="/img/tw.png">
      </head>`;
    const meta = parseOgMeta(html, PAGE);
    expect(meta.title).toBe('Fallback Title');
    expect(meta.description).toBe('Plain description');
    expect(meta.imageUrl).toBe('https://example.com/img/tw.png');
    expect(meta.siteName).toBe('');
  });

  it('prefers og:image:secure_url and the FIRST occurrence of a key', () => {
    const html = `
      <meta property="og:image" content="http://example.com/first.jpg">
      <meta property="og:image" content="http://example.com/second.jpg">
      <meta property="og:image:secure_url" content="https://example.com/secure.jpg">
      <meta property="og:title" content="First">
      <meta property="og:title" content="Second">`;
    const meta = parseOgMeta(html, PAGE);
    expect(meta.imageUrl).toBe('https://example.com/secure.jpg');
    expect(meta.title).toBe('First');
  });

  it('resolves relative and protocol-relative images against the page URL', () => {
    expect(parseOgMeta('<meta property="og:image" content="../c.png">', PAGE).imageUrl).toBe('https://example.com/c.png');
    expect(parseOgMeta('<meta property="og:image" content="//cdn.example.com/c.png">', PAGE).imageUrl).toBe(
      'https://cdn.example.com/c.png',
    );
  });

  it('drops non-http(s) images and tolerates meta tags without content', () => {
    const html = `
      <meta property="og:image" content="data:image/png;base64,AAAA">
      <meta property="og:title">
      <meta charset="utf-8">`;
    const meta = parseOgMeta(html, PAGE);
    expect(meta.imageUrl).toBeNull();
    expect(meta.title).toBe('');
  });

  it('collapses whitespace, strips stray markup and caps lengths', () => {
    const long = 'x'.repeat(600);
    const html = `
      <meta property="og:title" content="  Multi
      line   &lt;b&gt;title&lt;/b&gt;  ">
      <meta property="og:description" content="${long}">`;
    const meta = parseOgMeta(html, PAGE);
    expect(meta.title).toBe('Multi line title');
    expect(meta.description.length).toBeLessThanOrEqual(501);
    expect(meta.description.endsWith('…')).toBe(true);
  });

  it('returns empty fields for a page with no metadata', () => {
    expect(parseOgMeta('<html><body><p>nothing</p></body></html>', PAGE)).toEqual({
      url: PAGE,
      title: '',
      description: '',
      imageUrl: null,
      siteName: '',
    });
  });

  it('handles CJK content and numeric entities', () => {
    const html = `<meta property="og:title" content="&#x6280;&#26415;专区 &mdash; 华为">`;
    expect(parseOgMeta(html, PAGE).title).toBe('技术专区 — 华为');
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes named, decimal and hex entities and leaves unknown ones alone', () => {
    expect(decodeHtmlEntities('a &amp; b &lt;c&gt; &#65;&#x42; &nbsp;x &unknown;')).toBe('a & b <c> AB  x &unknown;');
  });
  it('is a no-op without an ampersand', () => {
    expect(decodeHtmlEntities('plain text')).toBe('plain text');
  });
});

describe('resolveImageUrl', () => {
  it('rejects javascript: / data: / blob: and unparsable values', () => {
    expect(resolveImageUrl('javascript:alert(1)', PAGE)).toBeNull();
    expect(resolveImageUrl('blob:https://x/y', PAGE)).toBeNull();
    expect(resolveImageUrl('', PAGE)).toBeNull();
    expect(resolveImageUrl(undefined, PAGE)).toBeNull();
    expect(resolveImageUrl('ftp://example.com/a.png', PAGE)).toBeNull();
  });
  it('decodes entities inside the attribute before resolving', () => {
    expect(resolveImageUrl('/a.png?x=1&amp;y=2', PAGE)).toBe('https://example.com/a.png?x=1&y=2');
  });
});

describe('normalizePreviewUrl', () => {
  it('keeps http(s) only, drops the hash, lowercases the host and default ports', () => {
    expect(normalizePreviewUrl(' HTTPS://Example.COM:443/Path?q=1#frag ')).toBe('https://example.com/Path?q=1');
    expect(normalizePreviewUrl('http://example.com:80/')).toBe('http://example.com/');
    expect(normalizePreviewUrl('http://example.com:8080/x')).toBe('http://example.com:8080/x');
  });
  it('rejects other schemes and junk', () => {
    expect(normalizePreviewUrl('ftp://example.com/x')).toBeNull();
    expect(normalizePreviewUrl('javascript:alert(1)')).toBeNull();
    expect(normalizePreviewUrl('not a url')).toBeNull();
    expect(normalizePreviewUrl('')).toBeNull();
  });
});
