import { describe, expect, it } from 'vitest';
import {
  isReturnableDest,
  loginHref,
  sanitizeCallbackPath,
  selfHref,
} from '@/lib/auth/callback-path';

const TAB = String.fromCharCode(9);
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const NUL = String.fromCharCode(0);

describe('sanitizeCallbackPath', () => {
  it('passes ordinary app-relative paths through', () => {
    expect(sanitizeCallbackPath('/settings')).toBe('/settings');
    expect(sanitizeCallbackPath('/videos/abc?focus=1')).toBe('/videos/abc?focus=1');
    expect(sanitizeCallbackPath('/skills/v1.2')).toBe('/skills/v1.2');
    expect(sanitizeCallbackPath(undefined)).toBe('/');
    expect(sanitizeCallbackPath(null)).toBe('/');
    expect(sanitizeCallbackPath('')).toBe('/');
  });

  it('accepts Next string[] searchParams (first value wins, house firstParam rule)', () => {
    expect(sanitizeCallbackPath(['/settings', '/other'])).toBe('/settings');
    expect(sanitizeCallbackPath([])).toBe('/');
    expect(sanitizeCallbackPath(['//evil.example'])).toBe('/');
  });

  it('keeps only the path of absolute URLs (foreign origin is discarded)', () => {
    expect(
      sanitizeCallbackPath('https://cari.rnd.huawei.com/ai-community/skills/x', '/ai-community'),
    ).toBe('/skills/x');
    expect(sanitizeCallbackPath('https://evil.example/x')).toBe('/x');
    expect(sanitizeCallbackPath('http://evil.example')).toBe('/');
  });

  it('rejects protocol-relative, backslash, and non-path values', () => {
    expect(sanitizeCallbackPath('//evil.example/x')).toBe('/');
    expect(sanitizeCallbackPath('/\\evil.example')).toBe('/');
    expect(sanitizeCallbackPath('javascript:alert(1)')).toBe('/');
  });

  it('rejects dot segments (literal and encoded) that would escape the basePath', () => {
    expect(sanitizeCallbackPath('/../cari_dste/x')).toBe('/');
    expect(sanitizeCallbackPath('/a/../b')).toBe('/');
    expect(sanitizeCallbackPath('/a/..')).toBe('/');
    expect(sanitizeCallbackPath('/a/./b')).toBe('/');
    expect(sanitizeCallbackPath('/ai-community/../x', '/ai-community')).toBe('/');
    expect(sanitizeCallbackPath('/%2e%2e/x')).toBe('/');
    expect(sanitizeCallbackPath('/a%5Cb')).toBe('/');
    // Encoded slashes in the QUERY are legitimate and preserved.
    expect(sanitizeCallbackPath('/videos/x?next=%2Fy')).toBe('/videos/x?next=%2Fy');
  });

  it('strips an already-present deploy basePath (prevents double-prefixing)', () => {
    expect(sanitizeCallbackPath('/ai-community/settings', '/ai-community')).toBe('/settings');
    expect(sanitizeCallbackPath('/ai-community', '/ai-community')).toBe('/');
    // Not a basePath segment — left alone.
    expect(sanitizeCallbackPath('/ai-community-else', '/ai-community')).toBe('/ai-community-else');
  });

  it('re-validates after the basePath strip', () => {
    expect(sanitizeCallbackPath('/ai-community//evil.example', '/ai-community')).toBe('/');
  });

  it('strips the basePath when the deploy ROOT carries a query or hash', () => {
    // Regression: the strip compared the WHOLE string, so these kept the prefix
    // and withBasePath() re-added it → /ai-community/ai-community?tab=x (404).
    // @auth/core produces exactly this shape: it bounces to pages.signIn with
    // the absolute stored callbackUrl (origin + basePath + path + query).
    expect(sanitizeCallbackPath('/ai-community?tab=x', '/ai-community')).toBe('/?tab=x');
    expect(sanitizeCallbackPath('/ai-community#c-7', '/ai-community')).toBe('/#c-7');
    expect(
      sanitizeCallbackPath('https://cari.rnd.huawei.com/ai-community?tab=x', '/ai-community'),
    ).toBe('/?tab=x');
    expect(sanitizeCallbackPath('/ai-community/zones/x?focus=1', '/ai-community')).toBe(
      '/zones/x?focus=1',
    );
    // Not the basePath segment — untouched, query and all.
    expect(sanitizeCallbackPath('/ai-community-else?a=1', '/ai-community')).toBe(
      '/ai-community-else?a=1',
    );
  });

  it('rejects C0 control characters anywhere in the value (open redirect)', () => {
    // WHATWG URL parsers REMOVE tab/CR/LF from anywhere in the input, so a
    // mid-path tab slips past the `//` check here and the BROWSER then reads
    // `//evil.example` as scheme-relative and leaves the origin. Node emits the
    // raw byte in a Location header, so this reached real users on the ROOT
    // deploy (the /ai-community prefix accidentally neutralised it there).
    expect(sanitizeCallbackPath(`/${TAB}/evil.example`, '')).toBe('/');
    expect(sanitizeCallbackPath(`/a${CR}/b`, '')).toBe('/');
    expect(sanitizeCallbackPath(`/a${LF}//evil.example`, '')).toBe('/');
    expect(sanitizeCallbackPath(`/x${NUL}`, '')).toBe('/');
    expect(sanitizeCallbackPath(`/ai-community/${TAB}/evil`, '/ai-community')).toBe('/');
    // …while ordinary paths and encoded spaces are untouched.
    expect(sanitizeCallbackPath('/zones/a%20b?q=1')).toBe('/zones/a%20b?q=1');
  });

  it('is a no-op on basePath handling at root deploys', () => {
    expect(sanitizeCallbackPath('/ai-community/settings', '')).toBe('/ai-community/settings');
  });
});

describe('loginHref', () => {
  it('omits the callbackUrl when the destination is the root', () => {
    expect(loginHref('/')).toBe('/auth/login');
    expect(loginHref(undefined)).toBe('/auth/login');
    expect(loginHref('//evil.example')).toBe('/auth/login');
  });

  it('ENCODES the destination — the query must not leak into the login url', () => {
    // The old hand-written literal produced a second `?`, so Next parsed
    // tab=reviews as a param of /auth/login and the callbackUrl lost it.
    expect(loginHref('/skills/x?tab=reviews')).toBe(
      '/auth/login?callbackUrl=%2Fskills%2Fx%3Ftab%3Dreviews',
    );
    expect(loginHref('/videos/shorts?v=abc&focus=d')).toBe(
      '/auth/login?callbackUrl=%2Fvideos%2Fshorts%3Fv%3Dabc%26focus%3Dd',
    );
  });

  it('never points the login page back at itself', () => {
    // The navbar link renders on /auth/login and /auth/error too; without this
    // a click there nests the login url inside its own callbackUrl and the page
    // promises to "take you back" to the login page.
    expect(loginHref('/auth/login')).toBe('/auth/login');
    expect(loginHref('/auth/login?callbackUrl=%2Fzones')).toBe('/auth/login');
    expect(loginHref('/auth/error?error=Configuration')).toBe('/auth/login');
    expect(loginHref('/auth/signup')).toBe('/auth/login');
    // Not an /auth route — unaffected.
    expect(loginHref('/authors/x')).toBe('/auth/login?callbackUrl=%2Fauthors%2Fx');
  });

  it('takes the first value of a string[] and refuses foreign origins', () => {
    expect(loginHref(['/zones/a', '/zones/b'])).toBe('/auth/login?callbackUrl=%2Fzones%2Fa');
    expect(loginHref('https://evil.example/x')).toBe('/auth/login?callbackUrl=%2Fx');
  });
});

describe('selfHref', () => {
  it('rebuilds a page url from its searchParams prop', () => {
    expect(selfHref('/videos/shorts', { v: 'abc', focus: 'c1' })).toBe(
      '/videos/shorts?v=abc&focus=c1',
    );
    expect(selfHref('/videos/shorts', {})).toBe('/videos/shorts');
    expect(selfHref('/videos/shorts')).toBe('/videos/shorts');
  });

  it('drops empty values and takes the first of a string[] (house firstParam rule)', () => {
    expect(selfHref('/x', { a: '', b: undefined, c: 'y' })).toBe('/x?c=y');
    expect(selfHref('/x', { a: ['1', '2'] })).toBe('/x?a=1');
  });

  it('encodes values so they survive the round trip', () => {
    expect(selfHref('/library/a/read', { hl: 'a b&c' })).toBe('/library/a/read?hl=a+b%26c');
  });
});

describe('isReturnableDest', () => {
  it('is false for the root and for the auth pages, true for real destinations', () => {
    expect(isReturnableDest('/')).toBe(false);
    expect(isReturnableDest('/auth')).toBe(false);
    expect(isReturnableDest('/auth/login')).toBe(false);
    expect(isReturnableDest('/auth/error?error=X')).toBe(false);
    expect(isReturnableDest('/zones/x?focus=1')).toBe(true);
    expect(isReturnableDest('/authors/x')).toBe(true);
  });
});
