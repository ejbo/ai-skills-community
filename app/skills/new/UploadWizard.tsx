'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Loader2, FileText, Upload } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { TokenCostBadge } from '@/components/TokenCostBadge';

interface Category {
  id: string;
  slug: string;
  name: string;
}

type Mode = 'form' | 'package';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function UploadWizard({
  categories,
  canPublishInternal,
}: {
  categories: Category[];
  canPublishInternal: boolean;
}) {
  const t = useTranslations('upload');
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('form');

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {(['form', 'package'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`relative px-4 py-2 text-sm font-medium transition ${
              mode === m ? 'text-zinc-900 dark:text-white' : 'text-muted hover:text-zinc-700 dark:hover:text-zinc-200'
            }`}
          >
            {m === 'form' ? t('mode_form') : t('mode_package')}
            {mode === m && (
              <motion.span
                layoutId="uploadTab"
                className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent-500"
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              />
            )}
          </button>
        ))}
      </div>

      {mode === 'form' ? (
        <FormMode categories={categories} canPublishInternal={canPublishInternal} onSuccess={(slug) => router.push(`/skills/${slug}`)} />
      ) : (
        <PackageMode />
      )}
    </div>
  );
}

function FormMode({
  categories,
  canPublishInternal,
  onSuccess,
}: {
  categories: Category[];
  canPublishInternal: boolean;
  onSuccess: (slug: string) => void;
}) {
  const t = useTranslations('upload');
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [summary, setSummary] = useState('');
  const [categoryId, setCategoryId] = useState<string>(categories[0]?.id ?? '');
  const [tagsRaw, setTagsRaw] = useState('');
  const [body, setBody] = useState('# My new skill\n\nDescribe what it does and when it triggers.\n');
  const [triggers, setTriggers] = useState('');
  const [license, setLicense] = useState('MIT');
  const [makeInternal, setMakeInternal] = useState(false);

  const tokenCost = Math.ceil(body.length / 4);

  function submit(action: 'draft' | 'publish') {
    startTransition(async () => {
      const finalSlug = slug || slugify(name);
      if (!finalSlug || !name || !summary) {
        pushToast('error', '请填写名称、slug 和描述');
        return;
      }
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: finalSlug,
          name,
          summary,
          descriptionMd: body,
          categoryId: categoryId || null,
          tags: tagsRaw.split(/[,\s]+/).filter(Boolean),
          triggers: triggers.split(/[,]+/).map((s) => s.trim()).filter(Boolean),
          license,
          sourceType: makeInternal && canPublishInternal ? 'internal' : 'user_uploaded',
          skillFormat: 'structured',
          publish: action === 'publish',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data.error ?? 'Failed');
        return;
      }
      pushToast('success', action === 'publish' ? '已发布' : '已保存草稿');
      onSuccess(data.skill.slug);
    });
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={t('name')}>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slug) setSlug(slugify(e.target.value));
              }}
              className="input"
            />
          </Field>
          <Field label={t('slug')}>
            <input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} className="input font-mono text-xs" />
          </Field>
        </div>
        <Field label={t('description')}>
          <input
            value={summary}
            onChange={(e) => setSummary(e.target.value.slice(0, 140))}
            maxLength={140}
            className="input"
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={t('category')}>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input">
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('tags')}>
            <input
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              placeholder="e.g. pdf, signing, forms"
              className="input"
            />
          </Field>
        </div>
        <Field label={t('content')}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            className="input font-mono text-[13px]"
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={t('triggers')}>
            <input
              value={triggers}
              onChange={(e) => setTriggers(e.target.value)}
              placeholder="comma-separated"
              className="input"
            />
          </Field>
          <Field label={t('license_label')}>
            <select value={license} onChange={(e) => setLicense(e.target.value)} className="input">
              {['MIT', 'Apache-2.0', 'BSD-3-Clause', 'GPL-3.0', 'Proprietary'].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </Field>
        </div>
        {canPublishInternal && (
          <label className="surface flex items-center justify-between rounded-xl px-4 py-2.5 text-sm">
            <div>
              <div className="font-medium">标记为内部专用</div>
              <div className="text-xs text-muted">仅作为类别区分，不影响访问权限</div>
            </div>
            <input
              type="checkbox"
              checked={makeInternal}
              onChange={(e) => setMakeInternal(e.target.checked)}
              className="h-4 w-4 accent-accent-500"
            />
          </label>
        )}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            disabled={pending}
            onClick={() => submit('draft')}
            className="rounded-lg border border-zinc-300 px-4 py-1.5 text-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            {t('save_draft')}
          </button>
          <button
            disabled={pending}
            onClick={() => submit('publish')}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('publish')}
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
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">{t('preview')}</div>
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h4 className="truncate font-semibold">{name || '<未命名>'}</h4>
          <p className="mt-1 line-clamp-2 text-xs text-muted">{summary || '<一句话描述会出现在这里>'}</p>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-muted">
            <TokenCostBadge tokens={tokenCost} compact />
          </div>
        </div>
        <p className="text-xs text-muted">
          token cost 估算基于正文长度 / 4，发布后会以服务器计算为准。
        </p>
      </aside>
    </div>
  );
}

function PackageMode() {
  const t = useTranslations('upload');
  const [dragging, setDragging] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        pushToast('info', 'zip 上传 finalize 接口接入中…暂请使用表单模式');
      }}
      className={`surface flex h-60 flex-col items-center justify-center rounded-2xl border-2 border-dashed transition ${
        dragging ? 'border-accent-500 bg-accent-500/5' : 'border-zinc-300 dark:border-zinc-700'
      }`}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-500/10 text-accent-600">
        <Upload className="h-6 w-6" />
      </div>
      <p className="mt-3 text-sm font-medium">{t('drop_zip')}</p>
      <p className="mt-1 text-xs text-muted">支持 SKILL.md + 附属脚本，单包 &lt; 5MB</p>
      <button className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-4 py-1.5 text-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
        <FileText className="h-3.5 w-3.5" />
        选择文件
      </button>
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
