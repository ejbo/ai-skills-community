'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Loader2, FileText, Upload } from 'lucide-react';
import type { SkillVisibility } from '@prisma/client';
import { pushToast } from '@/components/Toaster';
import { TokenCostBadge } from '@/components/TokenCostBadge';
import { VisibilitySelector } from '@/app/skills/_components/VisibilitySelector';

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
  const [body, setBody] = useState('# 新 Skill\n\n描述它能做什么以及在什么场景下触发。\n');
  const [triggers, setTriggers] = useState('');
  const [license, setLicense] = useState('MIT');
  const [makeInternal, setMakeInternal] = useState(false);
  const [visibility, setVisibility] = useState<SkillVisibility>('public');
  const [tokenCost, setTokenCost] = useState<number>(0);

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
          visibility,
          tokenCostEstimate: tokenCost,
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label={t('triggers')}>
            <input
              value={triggers}
              onChange={(e) => setTriggers(e.target.value)}
              placeholder="逗号分隔多个触发词"
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
        <Field label="可见性 / 访问权限">
          <VisibilitySelector value={visibility} onChange={setVisibility} />
        </Field>
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
          {tokenCost > 0 && (
            <div className="mt-3 flex items-center gap-2 text-[11px] text-muted">
              <TokenCostBadge tokens={tokenCost} compact />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function PackageMode() {
  const t = useTranslations('upload');
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [visibility, setVisibility] = useState<SkillVisibility>('public');
  const [pending, startTransition] = useTransition();
  const [parsed, setParsed] = useState<{
    name?: string;
    description?: string;
    version?: string;
    fileCount: number;
    totalBytes: number;
    tokenCost: number;
    slug?: string;
  } | null>(null);
  const [pendingPublish, startPublish] = useTransition();

  async function upload(file: File, publish: boolean) {
    if (!file.name.endsWith('.zip')) {
      pushToast('error', '请上传 .zip 文件');
      return;
    }
    const form = new FormData();
    form.set('file', file);
    form.set('visibility', visibility);
    if (publish) form.set('publish', 'true');
    const res = await fetch('/api/skills/upload-package', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reasons: Record<string, string> = {
        slug_taken: `slug "${data.slug}" 已被占用`,
        too_large: '包太大（>5MB）',
        parse_failed: `解析失败：${data.reason ?? ''}`,
        invalid_version: `frontmatter 里的 version 不合法：${data.version}`,
      };
      pushToast('error', reasons[data.error] ?? data.error ?? '上传失败');
      return;
    }
    if (publish) {
      pushToast('success', '已发布');
      router.push(`/skills/${data.skill.slug}`);
      return;
    }
    setParsed({ ...data.parsed, slug: data.skill.slug });
    pushToast('success', '解析成功，已存为草稿');
  }

  function pick(file: File | null | undefined) {
    if (!file) return;
    startTransition(() => upload(file, false));
  }

  return (
    <div className="space-y-3">
      <div className="surface rounded-2xl p-4">
        <div className="mb-1.5 text-xs font-medium text-muted">可见性 / 访问权限</div>
        <VisibilitySelector value={visibility} onChange={setVisibility} />
      </div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files?.[0]);
        }}
        className={`surface flex h-60 flex-col items-center justify-center rounded-2xl border-2 border-dashed transition ${
          dragging ? 'border-accent-500 bg-accent-500/5' : 'border-zinc-300 dark:border-zinc-700'
        } ${pending ? 'opacity-60' : 'cursor-pointer'}`}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-500/10 text-accent-600">
          {pending ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
        </div>
        <p className="mt-3 text-sm font-medium">{t('drop_zip')}</p>
        <p className="mt-1 text-xs text-muted">支持 SKILL.md + 附属脚本，单包 &lt; 5MB</p>
        <span className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-4 py-1.5 text-sm dark:border-zinc-700">
          <FileText className="h-3.5 w-3.5" />
          选择文件
        </span>
        <input
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          disabled={pending}
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </label>

      {parsed && (
        <div className="surface rounded-2xl p-4 text-sm">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-ok/15 px-2 py-0.5 text-xs font-medium text-ok">
            ✓ 已识别
          </div>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted">名称</dt>
            <dd>{parsed.name}</dd>
            <dt className="text-muted">描述</dt>
            <dd>{parsed.description}</dd>
            <dt className="text-muted">版本</dt>
            <dd className="font-mono">v{parsed.version}</dd>
            <dt className="text-muted">文件数 / 大小</dt>
            <dd className="font-mono">
              {parsed.fileCount} · {(parsed.totalBytes / 1024).toFixed(1)} KB
            </dd>
            <dt className="text-muted">Token 估算</dt>
            <dd className="font-mono">{parsed.tokenCost}</dd>
          </dl>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Link
              href={`/skills/${parsed.slug}/edit`}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              去编辑
            </Link>
            <button
              onClick={() => {
                if (!parsed.slug) return;
                startPublish(async () => {
                  const res = await fetch(`/api/skills/${parsed.slug}`, {
                    method: 'PUT',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ status: 'published' }),
                  });
                  if (!res.ok) {
                    pushToast('error', '发布失败');
                    return;
                  }
                  pushToast('success', '已发布');
                  router.push(`/skills/${parsed.slug}`);
                });
              }}
              disabled={pendingPublish}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-accent-500 px-3 text-xs font-medium text-white hover:bg-accent-600 disabled:opacity-60"
            >
              {pendingPublish && <Loader2 className="h-3 w-3 animate-spin" />}
              直接发布
            </button>
          </div>
        </div>
      )}
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
