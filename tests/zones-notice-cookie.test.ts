import { describe, expect, it } from 'vitest';
import {
  NOTICE_COOKIE,
  NOTICE_COOKIE_MAX_ENTRIES,
  noticeCookieHeader,
  parseNoticeCookie,
  readNoticeCookie,
  withNoticeDismissed,
} from '@/lib/zones/notice-cookie';

describe('notice cookie (版主公告 dismissal)', () => {
  it('parses garbage to an empty map', () => {
    expect(parseNoticeCookie(null).size).toBe(0);
    expect(parseNoticeCookie(undefined).size).toBe(0);
    expect(parseNoticeCookie('').size).toBe(0);
    expect(parseNoticeCookie('%%%').size).toBe(0);
    expect(parseNoticeCookie(':::').size).toBe(0);
    expect(parseNoticeCookie('zone:').size).toBe(0);
    expect(parseNoticeCookie(':post').size).toBe(0);
    expect(parseNoticeCookie('a b:c').size).toBe(0);
  });

  it('round-trips zone → dismissed post pairs', () => {
    const v = withNoticeDismissed('', 'zone1', 'post1');
    expect(parseNoticeCookie(v).get('zone1')).toBe('post1');
    expect(v).not.toMatch(/[;,\s]/);
  });

  it('replaces the same zone entry and appends new zones newest-last', () => {
    let v = withNoticeDismissed('', 'zoneA', 'p1');
    v = withNoticeDismissed(v, 'zoneB', 'p2');
    v = withNoticeDismissed(v, 'zoneA', 'p3');
    const map = parseNoticeCookie(v);
    expect(map.size).toBe(2);
    expect(map.get('zoneA')).toBe('p3');
    expect(map.get('zoneB')).toBe('p2');
    // zoneA was re-dismissed last, so it is the newest entry.
    expect([...map.keys()]).toEqual(['zoneB', 'zoneA']);
  });

  it('caps at NOTICE_COOKIE_MAX_ENTRIES, dropping the oldest', () => {
    let v = '';
    for (let i = 0; i < NOTICE_COOKIE_MAX_ENTRIES + 5; i += 1) v = withNoticeDismissed(v, `zone${i}`, `post${i}`);
    const map = parseNoticeCookie(v);
    expect(map.size).toBe(NOTICE_COOKIE_MAX_ENTRIES);
    expect(map.has('zone0')).toBe(false);
    expect(map.has('zone4')).toBe(false);
    expect(map.get('zone5')).toBe('post5');
    expect(map.get(`zone${NOTICE_COOKIE_MAX_ENTRIES + 4}`)).toBe(`post${NOTICE_COOKIE_MAX_ENTRIES + 4}`);
  });

  it('refuses ids carrying separators or whitespace and leaves the value unchanged', () => {
    const before = withNoticeDismissed('', 'zone1', 'post1');
    for (const bad of ['a;b', 'a,b', 'a:b', 'a b', 'a\tb', '', 'a.b']) {
      expect(withNoticeDismissed(before, bad, 'post2')).toBe(before);
      expect(withNoticeDismissed(before, 'zone2', bad)).toBe(before);
    }
  });

  it('builds a basePath-scoped cookie header', () => {
    const h = noticeCookieHeader('z:p', '/ai-community');
    expect(h.startsWith(`${NOTICE_COOKIE}=z:p;`)).toBe(true);
    expect(h).toContain('path=/ai-community/');
    expect(h).toContain('samesite=lax');
    expect(h).toContain('max-age=31536000');
    expect(noticeCookieHeader('z:p', '')).toContain('path=/;');
    // A trailing slash on the basePath must not double up.
    expect(noticeCookieHeader('z:p', '/ai-community/')).toContain('path=/ai-community/;');
  });

  it('reads its own value back out of a document.cookie string', () => {
    expect(readNoticeCookie(`theme=dark; ${NOTICE_COOKIE}=z1:p1.z2:p2; other=1`)).toBe('z1:p1.z2:p2');
    expect(readNoticeCookie('theme=dark')).toBeNull();
    expect(readNoticeCookie('')).toBeNull();
  });
});
