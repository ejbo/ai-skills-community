// Key parity across messages/{zh-CN,en,fr}.json. A key missing from one locale
// renders its raw key path (`ui.rte_line_height`) in production, and until this
// test the only guard was the manual `node scripts/zones-i18n-merge.mjs --check`
// — so a merged fragment with a missing locale could ship with CI green.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type Tree = { [key: string]: string | Tree };

const load = (locale: string) => JSON.parse(readFileSync(resolve(__dirname, `../messages/${locale}.json`), 'utf8')) as Tree;

function flat(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

describe('messages key parity', () => {
  const zh = new Set(flat(load('zh-CN')));
  for (const locale of ['en', 'fr']) {
    it(`${locale} has exactly the zh-CN keys`, () => {
      const keys = new Set(flat(load(locale)));
      expect([...zh].filter((k) => !keys.has(k))).toEqual([]);
      expect([...keys].filter((k) => !zh.has(k))).toEqual([]);
    });
  }
});
