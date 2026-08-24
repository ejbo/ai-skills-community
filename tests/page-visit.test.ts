import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  PAGE_NAMES,
  USER_SPECIFIC_TEMPLATES,
  displayVisitPath,
  normalizePath,
  redactUserSpecificPath,
  resolvePageName,
  resolvePageTemplate,
  sanitizeReferrer,
  shouldLogPath,
} from '@/lib/page-visit';

/** Every app/**\/page.tsx as a route template ("/skills/[slug]"), route groups stripped. */
function listRouteTemplates(): string[] {
  const root = resolve(__dirname, '..', 'app');
  const out: string[] = [];
  const walk = (dir: string, segs: string[]) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name.startsWith('_')) continue; // private folders
        walk(full, /^\(.*\)$/.test(name) ? segs : [...segs, name]);
      } else if (name === 'page.tsx') {
        out.push('/' + segs.join('/'));
      }
    }
  };
  walk(root, []);
  return out.sort();
}

function sampleFor(template: string): string {
  return template.replace(/\[\.\.\.[^\]]+\]/g, 'a/b').replace(/\[[^\]]+\]/g, 'sample-1');
}

describe('PAGE_NAMES covers the app routes (both directions)', () => {
  const routes = listRouteTemplates();
  const templates = PAGE_NAMES.map(([t]) => t);

  it('lists every page exactly once', () => {
    expect(new Set(templates).size).toBe(templates.length);
    const missing = routes.filter((r) => !templates.includes(r));
    expect(missing, `pages without a 页面访问 name: ${missing.join(', ')}`).toEqual([]);
  });

  it('has no stale entries for routes that no longer exist', () => {
    const stale = templates.filter((t) => !routes.includes(t));
    expect(stale, `PAGE_NAMES entries with no page.tsx: ${stale.join(', ')}`).toEqual([]);
  });

  it('resolves a concrete path of each route back to its own template', () => {
    for (const [template, name] of PAGE_NAMES) {
      const sample = sampleFor(template);
      expect(resolvePageTemplate(sample), sample).toBe(template);
      expect(resolvePageName(sample)).toBe(name);
    }
  });
});

describe('normalizePath / shouldLogPath', () => {
  it('strips query and hash, collapses trailing slashes', () => {
    expect(normalizePath('/skills/x?tab=files#top')).toBe('/skills/x');
    expect(normalizePath('/videos/')).toBe('/videos');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('videos')).toBe('/videos');
  });

  it('filters assets and APIs but keeps unknown pages', () => {
    for (const p of ['/api/skills', '/_next/static/x.js', '/static/a', '/favicon.ico', '/img/logo.png']) {
      expect(shouldLogPath(p), p).toBe(false);
    }
    expect(shouldLogPath('/some/new/page')).toBe(true);
    expect(shouldLogPath('')).toBe(false);
  });
});

describe('admin redaction of user-specific pages', () => {
  it('maps a specific user page to its template and nothing else', () => {
    expect(redactUserSpecificPath('/users/alice')).toBe('/users/[handle]');
    expect(redactUserSpecificPath('/manage/users/clx123')).toBe('/manage/users/[id]');
    expect(redactUserSpecificPath('/manage/users')).toBeNull();
    expect(redactUserSpecificPath('/skills/alice')).toBeNull();
    expect(redactUserSpecificPath('/users/alice/extra')).toBeNull();
  });

  it('keeps the page NAME while redacting the path', () => {
    expect(resolvePageName('/manage/users/clx123')).toBe('用户详情');
    expect(resolvePageName('/users/alice')).toBe('用户主页');
    for (const t of USER_SPECIFIC_TEMPLATES) expect(PAGE_NAMES.some(([x]) => x === t)).toBe(true);
  });

  it('displayVisitPath masks legacy rows only for staff and flags stored templates', () => {
    expect(displayVisitPath('/users/alice', true)).toEqual({ path: '/users/[handle]', redacted: true });
    expect(displayVisitPath('/users/alice', false)).toEqual({ path: '/users/alice', redacted: false });
    expect(displayVisitPath('/users/[handle]', false)).toEqual({ path: '/users/[handle]', redacted: true });
    expect(displayVisitPath('/skills/x', true)).toEqual({ path: '/skills/x', redacted: false });
  });
});

describe('sanitizeReferrer', () => {
  it('keeps only the pathname and redacts user pages for staff', () => {
    expect(sanitizeReferrer('https://h/manage/users/clx1?tab=visits#x', true)).toBe('/manage/users/[id]');
    expect(sanitizeReferrer('https://h/manage/users/clx1', false)).toBe('/manage/users/clx1');
    expect(sanitizeReferrer('https://h/manage/users?q=alice', true)).toBe('/manage/users');
    expect(sanitizeReferrer('https://h/users/alice', true)).toBe('/users/[handle]');
  });

  it('strips the basePath and drops junk', () => {
    expect(sanitizeReferrer('https://h/ai-community/users/alice', true, '/ai-community')).toBe('/users/[handle]');
    expect(sanitizeReferrer('https://h/ai-community', true, '/ai-community')).toBe('/');
    expect(sanitizeReferrer('not a url', true)).toBeNull();
    expect(sanitizeReferrer(null, true)).toBeNull();
    expect(sanitizeReferrer('https://h/api/internal/page-visit', false)).toBeNull();
  });
});
