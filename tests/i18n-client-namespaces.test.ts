import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  CLIENT_MESSAGE_NAMESPACES,
  pickClientMessages,
} from '@/lib/i18n-client-namespaces';

/**
 * app/layout.tsx ships ONLY the allowlisted namespaces to the browser, so a
 * component added later that reads a trimmed-away namespace would render the
 * raw key path ("feedback.title") to users instead of throwing. Nothing at
 * build time catches that — this suite is the guard. It rebuilds the client
 * module graph the same way the bundler does (a `'use client'` file, plus
 * everything such a file imports, transitively) and compares the namespaces
 * found there against the allowlist in BOTH directions.
 */

const ROOT = resolve(__dirname, '..');
const SOURCE_DIRS = ['app', 'components', 'lib', 'i18n'];
const EXTENSIONS = ['.ts', '.tsx'];

function listSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (EXTENSIONS.some((e) => full.endsWith(e))) out.push(full);
    }
  };
  for (const dir of SOURCE_DIRS) walk(join(ROOT, dir));
  return out;
}

const FILES = listSourceFiles();
const SOURCE = new Map(FILES.map((f) => [f, readFileSync(f, 'utf8')]));
const rel = (f: string) => f.slice(ROOT.length + 1);

/** `'use client'` only counts as the directive when nothing but comments precede it. */
function hasUseClientDirective(text: string): boolean {
  return /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(text);
}

/** Resolve `@/…` and relative specifiers to a file we scanned; bare packages are ignored. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const e of EXTENSIONS) if (existsSync(base + e)) return base + e;
  for (const e of EXTENSIONS) if (existsSync(join(base, `index${e}`))) return join(base, `index${e}`);
  return null;
}

// `from '…'` also catches re-exports; the second alternative is a bare side-effect
// import. `import type` is deliberately NOT excluded — over-including a module can
// only widen the allowlist, and a missing namespace is the failure that hurts users.
const SPECIFIER_RE = /(?:\bfrom\s*|^\s*import\s*|\bimport\(\s*)['"]([^'"]+)['"]/gm;

function importsOf(file: string): string[] {
  const out = new Set<string>();
  for (const m of (SOURCE.get(file) ?? '').matchAll(SPECIFIER_RE)) {
    const target = resolveSpecifier(file, m[1]);
    if (target && SOURCE.has(target)) out.add(target);
  }
  return [...out];
}

/** Every module the client bundle can reach: the `'use client'` files and their import closure. */
function collectClientReachable(): Set<string> {
  const seen = new Set<string>();
  const stack = FILES.filter((f) => hasUseClientDirective(SOURCE.get(f)!));
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of importsOf(file)) if (!seen.has(next)) stack.push(next);
  }
  return seen;
}

const CLIENT_FILES = collectClientReachable();

const NAMESPACE_RE = /useTranslations\(\s*(['"])([^'"]+)\1\s*\)/g;
const NON_LITERAL_RE = /useTranslations\(\s*(?!['"]\s*\)?|\))/g;
const BARE_DECL_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*useTranslations\(\s*\)/g;

/** `useTranslations('detail.chat')` needs the TOP-level key `detail` in the payload. */
const topLevel = (key: string) => key.split('.')[0];

type Usage = { namespace: string; file: string };

const literalUsages: Usage[] = [];
const bareUsages: Usage[] = [];
const bareNonLiteral: string[] = [];

for (const file of CLIENT_FILES) {
  const text = SOURCE.get(file)!;
  for (const m of text.matchAll(NAMESPACE_RE)) {
    literalUsages.push({ namespace: topLevel(m[2]), file: rel(file) });
  }
  // A bare `useTranslations()` translator is called with FULL key paths
  // (`g('common.delete')`), so its first segment is the namespace it needs.
  for (const decl of text.matchAll(BARE_DECL_RE)) {
    const callRe = new RegExp(`\\b${decl[1]}\\s*(?:\\.(?:rich|raw|markup|has))?\\(\\s*([^)]*)`, 'g');
    for (const call of text.matchAll(callRe)) {
      const arg = call[1].trim();
      const literal = /^(['"])([^'"]+)\1/.exec(arg);
      if (literal) bareUsages.push({ namespace: topLevel(literal[2]), file: rel(file) });
      else bareNonLiteral.push(`${rel(file)}: ${decl[1]}(${arg.slice(0, 40)}…)`);
    }
  }
}

const usedNamespaces = new Set(
  [...literalUsages, ...bareUsages].map((u) => u.namespace),
);
const allowed = new Set<string>(CLIENT_MESSAGE_NAMESPACES);

describe('client message namespace allowlist', () => {
  it('finds the client module graph at all (guards the scanner itself)', () => {
    expect(CLIENT_FILES.size).toBeGreaterThan(200);
    expect(literalUsages.length).toBeGreaterThan(100);
  });

  it('ships every namespace client components read', () => {
    const missing = [
      ...new Map(
        [...literalUsages, ...bareUsages]
          .filter((u) => !allowed.has(u.namespace))
          .map((u) => [u.namespace, u]),
      ).values(),
    ].map((u) => `${u.namespace} (first seen in ${u.file})`);
    expect(
      missing,
      `add these to CLIENT_MESSAGE_NAMESPACES or the browser renders raw key paths: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('has no stale entries (namespaces no client component reads any more)', () => {
    const stale = [...CLIENT_MESSAGE_NAMESPACES].filter((ns) => !usedNamespaces.has(ns));
    expect(
      stale,
      `CLIENT_MESSAGE_NAMESPACES entries with no client reader — drop them: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('is sorted and free of duplicates', () => {
    expect([...CLIENT_MESSAGE_NAMESPACES]).toEqual([...CLIENT_MESSAGE_NAMESPACES].sort());
    expect(allowed.size).toBe(CLIENT_MESSAGE_NAMESPACES.length);
  });

  it('only lists namespaces that exist in the catalog', () => {
    const catalog = JSON.parse(
      readFileSync(join(ROOT, 'messages/zh-CN.json'), 'utf8'),
    ) as Record<string, unknown>;
    const unknown = [...CLIENT_MESSAGE_NAMESPACES].filter((ns) => !(ns in catalog));
    expect(unknown, `not top-level keys of messages/zh-CN.json: ${unknown.join(', ')}`).toEqual([]);
  });
});

describe('client code stays statically analysable', () => {
  it('never passes a computed namespace to useTranslations', () => {
    const offenders: string[] = [];
    for (const file of CLIENT_FILES) {
      if (NON_LITERAL_RE.test(SOURCE.get(file)!)) offenders.push(rel(file));
      NON_LITERAL_RE.lastIndex = 0;
    }
    expect(
      offenders,
      `useTranslations(<variable>) cannot be audited — use a literal namespace: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('resolves every bare useTranslations() key to a literal namespace', () => {
    expect(
      bareNonLiteral,
      `a bare useTranslations() translator called with a computed key — the namespace it needs cannot be proven: ${bareNonLiteral.join(', ')}`,
    ).toEqual([]);
    expect(bareUsages.length).toBeGreaterThan(0);
  });

  it('never calls useMessages() in the client bundle', () => {
    // useMessages() hands the component the WHOLE tree, which the allowlist no
    // longer contains. useFormatter() is fine — it reads `formats`, not messages.
    const offenders = [...CLIENT_FILES]
      .filter((f) => /\buseMessages\s*\(/.test(SOURCE.get(f)!))
      .map(rel);
    expect(
      offenders,
      `useMessages() needs the full catalog, which no longer crosses to the client: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});

describe('pickClientMessages', () => {
  const catalog = JSON.parse(
    readFileSync(join(ROOT, 'messages/zh-CN.json'), 'utf8'),
  ) as Record<string, unknown>;

  it('keeps the allowlist and drops everything else', () => {
    const picked = pickClientMessages(catalog);
    expect(Object.keys(picked).sort()).toEqual([...CLIENT_MESSAGE_NAMESPACES].sort());
    for (const ns of CLIENT_MESSAGE_NAMESPACES) expect(picked[ns]).toBe(catalog[ns]);
  });

  it('omits absent namespaces instead of writing undefined branches', () => {
    const picked = pickClientMessages({ common: { a: 'x' } });
    expect(Object.keys(picked)).toEqual(['common']);
    expect('zones' in picked).toBe(false);
  });

  it('actually shrinks the payload the document inlines', () => {
    const full = JSON.stringify(catalog).length;
    const trimmed = JSON.stringify(pickClientMessages(catalog)).length;
    expect(trimmed).toBeLessThan(full * 0.75);
  });
});
