import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  isTrendingPeriod,
  parseCount,
  parseTrendingHtml,
} from '@/lib/github-trending-shared';

// Trimmed from a real github.com/trending?since=daily response: the star/fork
// anchors keep their inline <svg> (whose path data is full of digits) because
// that is exactly what a naive tag-strip gets wrong.
const STAR_SVG =
  '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16" class="octicon octicon-star">' +
  '<path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279Z"></path></svg>';

function row(opts: {
  fullName: string;
  description?: string;
  language?: string;
  color?: string;
  stars?: string;
  forks?: string;
  period?: string;
}): string {
  const { fullName } = opts;
  return `<article class="Box-row">
  <div class="float-right d-flex">
    <div class="BtnGroup d-flex">
      <a href="/login?return_to=%2F${fullName.replace('/', '%2F')}" rel="nofollow" class="btn">${STAR_SVG}<span>Star</span></a>
    </div>
  </div>
  <h2 class="h3 lh-condensed">
    <a href="/${fullName}" data-view-component="true" class="Link"><svg class="octicon octicon-repo"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75Z"></path></svg>
      <span class="text-normal">${fullName.split('/')[0]} / </span>
      ${fullName.split('/')[1]}</a>  </h2>
  ${
    opts.description === undefined
      ? ''
      : `<p class="col-9 color-fg-muted my-1 tmp-pr-4">\n      ${opts.description}\n    </p>`
  }
  <div class="f6 color-fg-muted mt-2">
    ${
      opts.language
        ? `<span class="tmp-mr-3 d-inline-block ml-0">
  <span class="repo-language-color" style="background-color: ${opts.color ?? '#3178c6'}"></span>
  <span itemprop="programmingLanguage">${opts.language}</span>
</span>`
        : ''
    }
    <a href="/${fullName}/stargazers" class="tmp-mr-3 Link Link--muted d-inline-block">${STAR_SVG}
      ${opts.stars ?? '16,935'}</a>
    <a href="/${fullName}/forks" class="tmp-mr-3 Link Link--muted d-inline-block">${STAR_SVG}
      ${opts.forks ?? '1,007'}</a>
    <span class="tmp-mr-3 d-inline-block">
      Built by
      <a class="d-inline-block" href="/someone"><img class="avatar" src="https://avatars.githubusercontent.com/u/50469282?s=40&amp;v=4" width="20" height="20" alt="@someone" /></a>
    </span>
    <span data-view-component="true" class="d-inline-block float-sm-right">
      ${opts.period ?? '3,651 stars today'}
    </span>
  </div>
</article>`;
}

const PAGE = `<!DOCTYPE html><html><body><div class="Box">
${row({
  fullName: 'cathrynlavery/diagram-design',
  description: '29 editorial diagram types for Claude Code. Self-contained HTML &amp; SVG.',
  language: 'HTML',
  color: '#e34c26',
  stars: '16,935',
  forks: '1,007',
  period: '3,651 stars today',
})}
${row({
  fullName: 'openai/whisper',
  description: 'Robust Speech Recognition via Large-Scale Weak Supervision',
  language: 'Python',
  color: '#3572A5',
  stars: '89,412',
  forks: '10,884',
  period: '661 stars today',
})}
${row({ fullName: 'someorg/no-metadata', period: '12 stars today' })}
</div></body></html>`;

describe('parseTrendingHtml', () => {
  const repos = parseTrendingHtml(PAGE);

  it('ranks every article in page order', () => {
    expect(repos).toHaveLength(3);
    expect(repos.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(repos.map((r) => r.fullName)).toEqual([
      'cathrynlavery/diagram-design',
      'openai/whisper',
      'someorg/no-metadata',
    ]);
  });

  it('splits owner and name and builds the canonical url', () => {
    expect(repos[1].owner).toBe('openai');
    expect(repos[1].name).toBe('whisper');
    expect(repos[1].url).toBe('https://github.com/openai/whisper');
  });

  it('reads counts past the inline svg path data', () => {
    // The <svg> path in the star anchor starts "M8 .25a.75..." — stripping tags
    // naively leaves those digits behind and yields 8 instead of 16935.
    expect(repos[0].stars).toBe(16935);
    expect(repos[0].forks).toBe(1007);
    expect(repos[0].periodStars).toBe(3651);
    expect(repos[1].stars).toBe(89412);
    expect(repos[1].periodStars).toBe(661);
  });

  it('decodes entities in the description', () => {
    expect(repos[0].description).toBe(
      '29 editorial diagram types for Claude Code. Self-contained HTML & SVG.',
    );
  });

  it('reads language name and colour', () => {
    expect(repos[0].language).toBe('HTML');
    expect(repos[0].languageColor).toBe('#e34c26');
    expect(repos[1].language).toBe('Python');
    expect(repos[1].languageColor).toBe('#3572A5');
  });

  it('tolerates rows with no description and no language', () => {
    expect(repos[2].description).toBe('');
    expect(repos[2].language).toBe('');
    expect(repos[2].languageColor).toBe('');
    expect(repos[2].periodStars).toBe(12);
  });

  it('never picks up the /login?return_to= star-button href as the repo', () => {
    expect(repos.every((r) => !r.fullName.startsWith('login'))).toBe(true);
    expect(repos.every((r) => r.fullName.split('/').length === 2)).toBe(true);
  });

  it('leaves the API-only fields empty when nothing enriched them', () => {
    expect(repos[0].topics).toEqual([]);
    expect(repos[0].license).toBe('');
    expect(repos[0].openIssues).toBe(0);
    expect(repos[0].pushedAt).toBe('');
  });

  it('returns an empty list instead of throwing on unrecognised markup', () => {
    expect(parseTrendingHtml('<html><body><p>nothing here</p></body></html>')).toEqual([]);
    expect(parseTrendingHtml('')).toEqual([]);
    // A truncated response must not hang or throw.
    expect(parseTrendingHtml('<article class="Box-row"><h2><a href="/a/b">')).toEqual([]);
  });

  it('de-duplicates a repo that appears twice', () => {
    const doubled = parseTrendingHtml(
      `${row({ fullName: 'a/b' })}${row({ fullName: 'a/b' })}${row({ fullName: 'c/d' })}`,
    );
    expect(doubled.map((r) => r.fullName)).toEqual(['a/b', 'c/d']);
    expect(doubled.map((r) => r.rank)).toEqual([1, 2]);
  });
});

describe('parseTrendingHtml is linear on hostile markup', () => {
  // The obvious `<tag[^>]*>([\s\S]*?)</tag>` spelling of every extractor here
  // is quadratic in unterminated openers: 1 MB of repeated `<svg ` used to be
  // ~106s of synchronous, uninterruptible CPU, which freezes this whole
  // single-process server. The intranet deploy's TLS-terminating proxy can
  // hand us any body, so this is a real bound. Budget is deliberately loose;
  // the quadratic version misses it by four orders of magnitude.
  const head = '<article class="Box-row"><h2 class="h3"><a href="/a/b">a / b</a></h2>';

  const cases: [string, string][] = [
    ['unterminated <svg', `<p class="col-9 x">${'<svg '.repeat(200_000)}</p>`],
    ['no closing angle', `<p class="col-9 x">${'<'.repeat(1_000_000)}</p>`],
    ['unterminated <h2', '<h2 '.repeat(250_000)],
    ['unterminated <span', '<span itemprop="programmingLanguage" '.repeat(50_000)],
    ['unterminated <a', '<a href="/a/b/stargazers" '.repeat(50_000)],
    ['megabytes of junk', 'x'.repeat(5_000_000)],
  ];

  it.each(cases)('%s finishes fast', (_label, payload) => {
    const started = Date.now();
    const repos = parseTrendingHtml(`${head}${payload}</article>`);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(repos).toHaveLength(1);
    expect(repos[0].fullName).toBe('a/b');
  });

  it('caps a single oversized article instead of scanning it all', () => {
    const padding = `<!-- ${'p'.repeat(200_000)} -->`;
    const repos = parseTrendingHtml(
      `${head}<p class="col-9 x">kept</p>${padding}` +
        `<span class="d-inline-block float-sm-right">999 stars today</span></article>`,
    );
    expect(repos[0].description).toBe('kept');
    // The float past the cap is not read, and that is the intended trade.
    expect(repos[0].periodStars).toBe(0);
  });

  it('stops after a bounded number of rows', () => {
    const many = Array.from(
      { length: 200 },
      (_, i) => `<article class="Box-row"><h2><a href="/o${i}/r${i}"></a></h2></article>`,
    ).join('');
    expect(parseTrendingHtml(many).length).toBeLessThanOrEqual(60);
  });
});

describe('parser tag matching', () => {
  it('does not mistake <path> for <p>', () => {
    const repos = parseTrendingHtml(
      '<article class="Box-row"><h2><a href="/a/b"></a></h2>' +
        '<svg><path class="col-9" d="M8 .25"></path></svg>' +
        '<p class="col-9 color-fg-muted">real description</p></article>',
    );
    expect(repos[0].description).toBe('real description');
  });

  it('ignores an <article> that is not a Box-row', () => {
    const repos = parseTrendingHtml(
      '<article class="Other"><h2><a href="/x/y"></a></h2></article>' +
        '<article class="Box-row"><h2><a href="/a/b"></a></h2></article>',
    );
    expect(repos.map((r) => r.fullName)).toEqual(['a/b']);
  });
});

describe('parseCount', () => {
  it('takes the first integer and drops thousands separators', () => {
    expect(parseCount('19,032')).toBe(19032);
    expect(parseCount('897 stars today')).toBe(897);
    expect(parseCount('1,234 stars this week')).toBe(1234);
    expect(parseCount('no digits here')).toBe(0);
    expect(parseCount('')).toBe(0);
  });
});

describe('decodeEntities', () => {
  it('handles named, decimal and hex references', () => {
    expect(decodeEntities('a &amp; b')).toBe('a & b');
    expect(decodeEntities('&lt;tag&gt;')).toBe('<tag>');
    expect(decodeEntities('it&#39;s')).toBe("it's");
    expect(decodeEntities('&#x27;quoted&#x27;')).toBe("'quoted'");
    expect(decodeEntities('&unknown;')).toBe('&unknown;');
  });

  it('does not resolve entity names off Object.prototype', () => {
    // `key in NAMED_ENTITIES` walked the prototype chain, so `&constructor;`
    // decoded to the Object source string.
    expect(decodeEntities('&constructor;')).toBe('&constructor;');
    expect(decodeEntities('&toString;')).toBe('&toString;');
    expect(decodeEntities('&__proto__;')).toBe('&__proto__;');
  });

  it('leaves an out-of-range numeric reference alone instead of throwing', () => {
    // String.fromCodePoint throws RangeError past U+10FFFF, which would have
    // aborted the whole parse from one malformed reference.
    expect(() => decodeEntities('&#x7FFFFFFF;')).not.toThrow();
    expect(decodeEntities('&#x7FFFFFFF;')).toBe('&#x7FFFFFFF;');
    expect(decodeEntities('&#1114112;')).toBe('&#1114112;');
    expect(decodeEntities('&#x10FFFF;')).toBe(String.fromCodePoint(0x10ffff));
  });
});

describe('isTrendingPeriod', () => {
  it('accepts only the three github windows', () => {
    expect(isTrendingPeriod('daily')).toBe(true);
    expect(isTrendingPeriod('weekly')).toBe(true);
    expect(isTrendingPeriod('monthly')).toBe(true);
    expect(isTrendingPeriod('yearly')).toBe(false);
    expect(isTrendingPeriod(null)).toBe(false);
  });
});
