'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Loader2, GitFork, Eye, Code } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

interface Source {
  slug: string;
  name: string;
  summary: string;
  descriptionMd: string;
  categoryId: string | null;
  license: string;
  tokenCostEstimate: number;
}

interface Category {
  id: string;
  slug: string;
  name: string;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

function diffLines(orig: string, modified: string): Array<{ kind: 'same' | 'add' | 'del'; text: string }> {
  const a = orig.split('\n');
  const b = modified.split('\n');
  const result: Array<{ kind: 'same' | 'add' | 'del'; text: string }> = [];
  // Trivial line-by-line diff (Myers-lite). For MVP this is enough — files are small.
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) {
      result.push({ kind: 'same', text: a[i] ?? '' });
    } else {
      if (a[i] !== undefined) result.push({ kind: 'del', text: a[i] });
      if (b[i] !== undefined) result.push({ kind: 'add', text: b[i] });
    }
  }
  return result;
}

export function RemixEditor({ source, categories }: { source: Source; categories: Category[] }) {
  const router = useRouter();
  const [name, setName] = useState(`${source.name} (Remix)`);
  const [slug, setSlug] = useState(slugify(`${source.slug}-remix`));
  const [summary, setSummary] = useState(source.summary);
  const [body, setBody] = useState(source.descriptionMd);
  const [categoryId, setCategoryId] = useState(source.categoryId ?? '');
  const [license, setLicense] = useState(source.license);
  const [tokenCost, setTokenCost] = useState(source.tokenCostEstimate);
  const [view, setView] = useState<'edit' | 'diff'>('edit');
  const [pending, startTransition] = useTransition();

  const diff = useMemo(() => diffLines(source.descriptionMd, body), [source.descriptionMd, body]);
  const additions = diff.filter((d) => d.kind === 'add').length;
  const deletions = diff.filter((d) => d.kind === 'del').length;

  function publish(action: 'draft' | 'publish') {
    if (!name || !slug || !summary) {
      pushToast('error', '请填写名称、slug 和描述');
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/skills/${source.slug}/remix`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug,
          name,
          summary,
          descriptionMd: body,
          categoryId: categoryId || null,
          license,
          tokenCostEstimate: tokenCost,
          publish: action === 'publish',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data.error ?? '发布失败');
        return;
      }
      pushToast('success', action === 'publish' ? 'Remix 已发布' : '草稿已保存');
      router.push(`/skills/${data.skill.slug}`);
    });
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_280px]">
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="新名称">
            <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
          </Field>
          <Field label="新 slug">
            <input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} className="input font-mono text-xs" />
          </Field>
        </div>
        <Field label="一行描述">
          <input value={summary} onChange={(e) => setSummary(e.target.value.slice(0, 140))} maxLength={140} className="input" />
        </Field>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="类别">
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input">
              <option value="">未分类</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="许可证">
            <select value={license} onChange={(e) => setLicense(e.target.value)} className="input">
              {['MIT', 'Apache-2.0', 'BSD-3-Clause', 'GPL-3.0', 'Proprietary'].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="Token 成本">
            <input
              type="number"
              min={0}
              max={50000}
              step={100}
              value={tokenCost || ''}
              onChange={(e) => setTokenCost(Number(e.target.value) || 0)}
              className="input font-mono tabular-nums"
            />
          </Field>
        </div>

        <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
          {(['edit', 'diff'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setView(m)}
              className={`relative px-3 py-1.5 text-xs font-medium transition ${
                view === m ? 'text-zinc-900 dark:text-white' : 'text-muted hover:text-zinc-700 dark:hover:text-zinc-200'
              }`}
            >
              <span className="flex items-center gap-1">
                {m === 'edit' ? <Code className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                {m === 'edit' ? '编辑' : 'Diff vs 原版'}
              </span>
              {view === m && (
                <motion.span
                  layoutId="remixTab"
                  className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent-500"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
            </button>
          ))}
          <span className="ml-auto self-center text-[11px] text-muted">
            <span className="text-ok">+{additions}</span> <span className="text-danger">-{deletions}</span>
          </span>
        </div>

        {view === 'edit' ? (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={20}
            className="input font-mono text-[13px]"
          />
        ) : (
          <pre className="surface max-h-[480px] overflow-auto rounded-xl p-3 font-mono text-[12px] leading-relaxed">
            {diff.map((line, i) => (
              <div
                key={i}
                className={
                  line.kind === 'add'
                    ? 'bg-ok/10 text-ok'
                    : line.kind === 'del'
                      ? 'bg-danger/10 text-danger line-through'
                      : 'text-zinc-600 dark:text-zinc-400'
                }
              >
                <span className="select-none pr-2 text-zinc-400">
                  {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
                </span>
                {line.text || ' '}
              </div>
            ))}
          </pre>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => publish('draft')}
            className="rounded-lg border border-zinc-300 px-4 py-1.5 text-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            存为草稿
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => publish('publish')}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitFork className="h-3.5 w-3.5" />}
            发布 Remix
          </button>
        </div>

        <style jsx>{`
          .input {
            width: 100%;
            min-height: 2.5rem;
            padding: 0.5rem 0.75rem;
            border-radius: 0.5rem;
            border: 1px solid rgb(var(--border));
            background: rgb(var(--surface));
            font-size: 0.875rem;
            transition: border-color 150ms;
          }
          .input:focus {
            border-color: rgb(var(--accent));
            outline: none;
            box-shadow: 0 0 0 3px rgb(var(--accent) / 0.15);
          }
        `}</style>
      </div>

      <aside className="surface space-y-3 rounded-2xl p-4 text-sm">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">原 Skill</div>
        <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="font-medium">{source.name}</div>
          <div className="mt-1 text-xs text-muted">{source.summary}</div>
        </div>
        <p className="text-xs text-muted">
          发布后会创建一个新的 Skill，归你所有；原 Skill 详情页会显示「被 Remix N 次」。
        </p>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
