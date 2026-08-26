// Merge 技术专区 i18n fragments into messages/{zh-CN,en,fr}.json and assert key parity.
//
// Fragment shape (one file per implementation agent):
//   { "<namespace>": { "<key>": { "zh-CN": "…", "en": "…", "fr": "…" } | { nested… } } }
// A leaf is any object that has a "zh-CN" string. Existing keys in messages/*.json are
// never overwritten (first writer wins; a differing fragment value is reported).
//
//   node scripts/zones-i18n-merge.mjs <fragmentDir>            merge + parity check
//   node scripts/zones-i18n-merge.mjs --check                  parity check only

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const LOCALES = ['zh-CN', 'en', 'fr'];
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const messagesPath = (l) => join(ROOT, 'messages', `${l}.json`);

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const fragmentDir = args.find((a) => !a.startsWith('--'));

const isLeaf = (v) => v && typeof v === 'object' && typeof v['zh-CN'] === 'string';

function flat(o, p = '') {
  return Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) ? flat(v, `${p}${k}.`) : [`${p}${k}`],
  );
}

const messages = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(readFileSync(messagesPath(l), 'utf8'))]));

let added = 0;
const conflicts = [];
const badLeaves = [];

function mergeNode(node, path, file) {
  for (const [key, value] of Object.entries(node)) {
    const full = [...path, key];
    if (isLeaf(value)) {
      for (const l of LOCALES) {
        if (typeof value[l] !== 'string' || !value[l].trim()) badLeaves.push(`${file}: ${full.join('.')} missing ${l}`);
      }
      for (const l of LOCALES) {
        let cur = messages[l];
        for (const seg of full.slice(0, -1)) {
          if (cur[seg] === undefined) cur[seg] = {};
          else if (typeof cur[seg] !== 'object') {
            conflicts.push(`${file}: ${full.join('.')} collides with a string at ${seg} (${l})`);
            cur = null;
            break;
          }
          cur = cur[seg];
        }
        if (!cur) continue;
        const leaf = full[full.length - 1];
        if (cur[leaf] === undefined) {
          cur[leaf] = value[l] ?? value['zh-CN'];
          if (l === 'zh-CN') added++;
        } else if (cur[leaf] !== value[l] && l === 'zh-CN') {
          conflicts.push(`${file}: ${full.join('.')} already exists with a different zh-CN value (kept existing)`);
        }
      }
    } else if (value && typeof value === 'object') {
      mergeNode(value, full, file);
    } else {
      badLeaves.push(`${file}: ${full.join('.')} is not a {zh-CN,en,fr} leaf`);
    }
  }
}

if (!checkOnly) {
  if (!fragmentDir || !existsSync(fragmentDir)) {
    console.error('usage: node scripts/zones-i18n-merge.mjs <fragmentDir> | --check');
    process.exit(2);
  }
  const files = readdirSync(fragmentDir).filter((f) => f.endsWith('.json')).sort();
  for (const f of files) {
    let frag;
    try {
      frag = JSON.parse(readFileSync(join(fragmentDir, f), 'utf8'));
    } catch (e) {
      console.error(`invalid JSON in ${f}: ${e.message}`);
      process.exit(2);
    }
    mergeNode(frag, [], f);
  }
  for (const l of LOCALES) writeFileSync(messagesPath(l), `${JSON.stringify(messages[l], null, 2)}\n`);
  console.log(`merged ${files.length} fragment(s): +${added} key(s)`);
  if (conflicts.length) console.log(`conflicts (${conflicts.length}):\n  ${conflicts.join('\n  ')}`);
  if (badLeaves.length) {
    console.error(`bad leaves (${badLeaves.length}):\n  ${badLeaves.join('\n  ')}`);
  }
}

// Parity check
const zh = new Set(flat(messages['zh-CN']));
let ok = true;
for (const l of ['en', 'fr']) {
  const s = new Set(flat(messages[l]));
  const missing = [...zh].filter((k) => !s.has(k));
  const extra = [...s].filter((k) => !zh.has(k));
  if (missing.length || extra.length) ok = false;
  console.log(`${l}: ${s.size} keys, missing ${missing.length}, extra ${extra.length}`);
  if (missing.length) console.log(`  missing: ${missing.slice(0, 40).join(', ')}${missing.length > 40 ? ' …' : ''}`);
  if (extra.length) console.log(`  extra: ${extra.slice(0, 40).join(', ')}${extra.length > 40 ? ' …' : ''}`);
}
console.log(`zh-CN: ${zh.size} keys`);
if (!ok || badLeaves.length) process.exit(1);
