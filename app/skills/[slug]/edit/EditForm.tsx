'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Trash2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { TokenCostBadge } from '@/components/TokenCostBadge';

interface SkillData {
  slug: string;
  name: string;
  summary: string;
  descriptionMd: string;
  categoryId: string | null;
  license: string;
  status: 'draft' | 'published' | 'archived';
  tokenCostEstimate: number;
}

interface Category {
  id: string;
  slug: string;
  name: string;
}

export function EditForm({ skill, categories }: { skill: SkillData; categories: Category[] }) {
  const router = useRouter();
  const [name, setName] = useState(skill.name);
  const [summary, setSummary] = useState(skill.summary);
  const [body, setBody] = useState(skill.descriptionMd);
  const [categoryId, setCategoryId] = useState(skill.categoryId ?? '');
  const [license, setLicense] = useState(skill.license);
  const [status, setStatus] = useState(skill.status);
  const [tokenCost, setTokenCost] = useState(skill.tokenCostEstimate);
  const [pending, startTransition] = useTransition();
  const [deletePending, startDelete] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await fetch(`/api/skills/${skill.slug}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          summary,
          descriptionMd: body,
          categoryId: categoryId || null,
          license,
          status,
          tokenCostEstimate: tokenCost,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data.error ?? '保存失败');
        return;
      }
      pushToast('success', '已保存');
      router.push(`/skills/${skill.slug}`);
      router.refresh();
    });
  }

  function remove() {
    if (!confirm('确定要删除这个 Skill？此操作不可撤销。')) return;
    startDelete(async () => {
      const res = await fetch(`/api/skills/${skill.slug}`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', '删除失败');
        return;
      }
      pushToast('success', '已删除');
      router.push('/dashboard');
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="名称">
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
        </Field>
        <Field label="Slug（不可改）">
          <input value={skill.slug} readOnly disabled className="input font-mono text-xs text-muted" />
        </Field>
      </div>
      <Field label="一行描述">
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value.slice(0, 140))}
          maxLength={140}
          className="input"
        />
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
            placeholder="如 1200"
            className="input font-mono tabular-nums"
          />
        </Field>
      </div>
      <Field label="Skill 正文">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={16}
          className="input font-mono text-[13px]"
        />
      </Field>

      <Field label="状态">
        <div className="flex gap-2">
          {(['draft', 'published', 'archived'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`flex-1 rounded-lg border px-3 py-1.5 text-sm transition ${
                status === s
                  ? 'border-accent-500 bg-accent-500/10 text-accent-700 dark:text-accent-300'
                  : 'border-zinc-300 hover:border-zinc-400 dark:border-zinc-700'
              }`}
            >
              {s === 'draft' ? '草稿' : s === 'published' ? '已发布' : '归档'}
            </button>
          ))}
        </div>
      </Field>

      <div className="flex items-center justify-between gap-2 pt-2">
        <button
          type="button"
          disabled={deletePending}
          onClick={remove}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-danger/40 px-4 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:opacity-60"
        >
          {deletePending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          删除
        </button>
        <div className="flex items-center gap-3">
          {tokenCost > 0 && <TokenCostBadge tokens={tokenCost} compact />}
          <Link
            href={`/skills/${skill.slug}`}
            className="rounded-lg border border-zinc-300 px-4 py-1.5 text-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            取消
          </Link>
          <button
            type="button"
            disabled={pending}
            onClick={save}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            保存
          </button>
        </div>
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
