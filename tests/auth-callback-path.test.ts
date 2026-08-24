import { describe, expect, it } from 'vitest';
import { sanitizeCallbackPath } from '@/lib/auth/callback-path';

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

  it('is a no-op on basePath handling at root deploys', () => {
    expect(sanitizeCallbackPath('/ai-community/settings', '')).toBe('/ai-community/settings');
  });
});
