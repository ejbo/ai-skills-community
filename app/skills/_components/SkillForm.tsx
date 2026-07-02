'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ChevronRight, Maximize2 } from 'lucide-react';
import type { SkillVisibility, SkillStatus, SourceType } from '@prisma/client';
import { pushToast } from '@/components/Toaster';
import { TokenCostBadge } from '@/components/TokenCostBadge';
import { RichTextEditor } from '@/components/RichTextEditor';
import { VisibilitySelector } from '@/app/skills/_components/VisibilitySelector';
import type { AssistAction } from '@/lib/skill-assist';
import { AiFieldButton, AiAutofillButton } from './AiButton';
import { TagInput } from './TagInput';
import { FileDropZone } from './FileDropZone';
import { requestAssist, type AssistError } from './assist-client';
import {
  type StagedFile,
  hasSkillMd,
  findReadme,
  findSkillMd,
  buildZip,
  readStagedText,
  parseFrontmatterLite,
  MAX_PACKAGE_BYTES,
} from './staged';

interface Category {
  id: string;
  slug: string;
  name: string;
}

export interface SkillFormInitial {
  slug: string;
  name: string;
  summary: string;
  descriptionMd: string;
  categoryId: string | null;
  license: string;
  sourceType: SourceType;
  status: SkillStatus;
  visibility: SkillVisibility;
  tokenCostEstimate: number;
  tags: string[];
  triggers: string[];
  skillMd: string; // current version content, for AI context
}

const LICENSES = ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'GPL-3.0', 'Proprietary'];

// Author-selectable source category — no permission gate, but a create-form must
// pick one explicitly (no pre-selection).
const SOURCE_OPTIONS: { value: SourceType; label: string }[] = [
  { value: 'external', label: '外部' },
  { value: 'curated', label: '官方搬运' },
  { value: 'internal', label: '内部' },
];

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

export function SkillForm({
  mode,
  categories,
  aiEnabled,
  initial,
}: {
  mode: 'create' | 'edit';
  categories: Category[];
  aiEnabled: boolean;
  initial?: SkillFormInitial;
}) {
  const router = useRouter();

  const [name, setName] = useState(initial?.name ?? '');
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [overview, setOverview] = useState(initial?.descriptionMd ?? '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [sourceType, setSourceType] = useState<SourceType | ''>(initial?.sourceType ?? '');
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [triggers, setTriggers] = useState<string[]>(initial?.triggers ?? []);
  const [license, setLicense] = useState(initial?.license ?? 'MIT');
  const [visibility, setVisibility] = useState<SkillVisibility>(initial?.visibility ?? 'public');
  const [status, setStatus] = useState<SkillStatus>(initial?.status ?? 'draft');
  const [tokenCost, setTokenCost] = useState(initial?.tokenCostEstimate ?? 0);

  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [useReadme, setUseReadme] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [overviewExpanded, setOverviewExpanded] = useState(false);

  const [assisting, setAssisting] = useState<AssistAction | null>(null);
  const [pending, startTransition] = useTransition();

  const readme = useMemo(() => findReadme(staged), [staged]);
  const skillMdPresent = useMemo(() => hasSkillMd(staged), [staged]);
  const readmeOverviewActive = mode === 'create' && useReadme && Boolean(readme);

  // AI is usable once there's skill content to read.
  const aiReady = aiEnabled && (mode === 'edit' ? Boolean(initial?.skillMd?.trim()) : skillMdPresent);

  async function onStagedChange(next: StagedFile[]) {
    setStaged(next);
    const sm = findSkillMd(next);
    if (!sm) return;
    const text = sm.file ? await sm.file.text() : sm.bytes ? new TextDecoder().decode(sm.bytes) : '';
    const fm = parseFrontmatterLite(text);
    // Pre-fill only empty fields from the SKILL.md frontmatter.
    setName((v) => v || fm.name || '');
    setSlug((v) => v || slugify(fm.name ?? ''));
    setSummary((v) => v || (fm.description ?? '').slice(0, 140));
    setTriggers((v) => (v.length > 0 ? v : fm.triggers ?? []));
    if (fm.license) setLicense((v) => (v === 'MIT' ? fm.license! : v));
  }

  async function getAssistContent() {
    if (mode === 'edit') {
      return { skillMd: initial?.skillMd ?? '', readme: overview || null, files: [] as { path: string; content: string }[] };
    }
    return readStagedText(staged);
  }

  function applyResult(action: AssistAction, r: Awaited<ReturnType<typeof requestAssist>>) {
    if (action === 'autofill') {
      if (r.name && !name) setName(r.name);
      if (r.summary && !summary) setSummary(r.summary);
      if (r.descriptionMd && !overview) {
        setOverview(r.descriptionMd);
        setUseReadme(false);
      }
      if (r.tags && tags.length === 0) setTags(r.tags);
      if (r.triggers && triggers.length === 0) setTriggers(r.triggers);
      return;
    }
    if (action === 'name' && r.name) setName(r.name);
    if (action === 'summary' && r.summary) setSummary(r.summary);
    if (action === 'overview') {
      if (r.descriptionMd) {
        setOverview(r.descriptionMd);
        setUseReadme(false);
      }
      if (r.summary && !summary) setSummary(r.summary);
    }
    if (action === 'tags' && r.tags) setTags(r.tags);
    if (action === 'triggers' && r.triggers) setTriggers(r.triggers);
    if (action === 'tokens' && typeof r.tokenCost === 'number') setTokenCost(r.tokenCost);
  }

  async function runAssist(action: AssistAction) {
    setAssisting(action);
    try {
      const content = await getAssistContent();
      if (!content.skillMd.trim()) {
        pushToast('error', '先添加 SKILL.md 内容，AI 才能读取生成。');
        return;
      }
      const result = await requestAssist({
        action,
        skillMd: content.skillMd,
        readme: content.readme,
        files: content.files,
        current: { name, summary, descriptionMd: overview, tags, triggers },
      });
      applyResult(action, result);
      pushToast('success', action === 'autofill' ? 'AI 已补全空字段' : 'AI 生成完成');
    } catch (e) {
      pushToast('error', (e as AssistError)?.message ?? 'AI 生成失败');
    } finally {
      setAssisting(null);
    }
  }

  function aiBtn(action: AssistAction, label = 'AI') {
    if (!aiEnabled) return null;
    return (
      <AiFieldButton
        label={label}
        loading={assisting === action}
        disabled={!aiReady || (assisting !== null && assisting !== action)}
        onClick={() => runAssist(action)}
      />
    );
  }

  function submitCreate(publish: boolean) {
    if (!skillMdPresent) {
      pushToast('error', '缺少 SKILL.md —— 请先添加含 SKILL.md 的文件');
      return;
    }
    if (!name.trim() || !summary.trim()) {
      pushToast('error', '请填写名称和一行描述');
      return;
    }
    if (!sourceType) {
      pushToast('error', '请选择来源分类（外部 / 官方搬运 / 内部）');
      return;
    }
    startTransition(async () => {
      const zip = await buildZip(staged);
      if (zip.size > MAX_PACKAGE_BYTES) {
        pushToast('error', `打包后 ${(zip.size / 1024 / 1024).toFixed(1)}MB，超过 5MB 上限`);
        return;
      }
      const form = new FormData();
      form.set('file', zip);
      form.set('name', name);
      form.set('summary', summary);
      form.set('slug', slug || slugify(name));
      form.set('license', license);
      form.set('visibility', visibility);
      form.set('sourceType', sourceType);
      // Only override the server's automatic heuristic when the author set a value.
      if (tokenCost > 0) form.set('tokenCostEstimate', String(tokenCost));
      if (categoryId) form.set('categoryId', categoryId);
      if (tags.length) form.set('tags', JSON.stringify(tags));
      if (triggers.length) form.set('triggers', JSON.stringify(triggers));
      if (readmeOverviewActive) {
        form.set('overviewSource', 'readme');
      } else {
        form.set('overviewSource', 'custom');
        form.set('customOverview', overview);
      }
      if (publish) form.set('publish', 'true');

      const res = await fetch('/api/skills/upload-package', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reasons: Record<string, string> = {
          slug_taken: `slug「${data.slug}」已被占用，换一个`,
          too_large: '包太大（>5MB）',
          parse_failed: `解析失败：${data.reason ?? ''}`,
          invalid_version: `SKILL.md 里的 version 不合法：${data.version ?? ''}`,
        };
        pushToast('error', reasons[data.error] ?? data.error ?? '上传失败');
        return;
      }
      pushToast('success', publish ? '已发布' : '已存为草稿');
      router.push(publish ? `/skills/${data.skill.slug}` : `/skills/${data.skill.slug}/manage`);
      router.refresh();
    });
  }

  function submitEdit() {
    if (!initial) return;
    if (!name.trim() || !summary.trim()) {
      pushToast('error', '请填写名称和一行描述');
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/skills/${initial.slug}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          summary,
          descriptionMd: overview,
          categoryId: categoryId || null,
          license,
          sourceType: sourceType || undefined,
          status,
          visibility,
          tokenCostEstimate: tokenCost,
          tags,
          triggers,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data.error ?? '保存失败');
        return;
      }
      pushToast('success', '已保存');
      router.refresh();
    });
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_280px]">
      <div className="space-y-3.5">
        {aiEnabled && (
          <AiAutofillButton
            loading={assisting === 'autofill'}
            disabled={!aiReady || (assisting !== null && assisting !== 'autofill')}
            onClick={() => runAssist('autofill')}
          />
        )}

        <div className="surface space-y-3 rounded-2xl p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="名称" ai={aiBtn('name')}>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (mode === 'create' && !slug) setSlug(slugify(e.target.value));
                }}
                className="input"
                placeholder="例如：PDF 表单签署"
              />
            </Field>
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
          </div>

          <Field label="来源分类" hint={mode === 'create' ? '发布前必选一项' : undefined}>
            <div className="flex gap-2">
              {SOURCE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setSourceType(o.value)}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-sm transition ${
                    sourceType === o.value
                      ? 'border-accent-500 bg-accent-500/10 text-accent-700 dark:text-accent-300'
                      : 'border-zinc-300 hover:border-zinc-400 dark:border-zinc-700'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="一行描述" ai={aiBtn('summary')}>
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value.slice(0, 140))}
              maxLength={140}
              className="input"
              placeholder="一句话说明它能做什么"
            />
          </Field>

          <Field
            label="Overview / 公开简介"
            ai={
              <span className="flex items-center gap-1.5">
                {!readmeOverviewActive && (
                  <button
                    type="button"
                    onClick={() => setOverviewExpanded(true)}
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  >
                    <Maximize2 className="h-3 w-3" />
                    全屏编辑
                  </button>
                )}
                {aiBtn('overview', 'AI 生成')}
              </span>
            }
          >
            {readmeOverviewActive ? (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-muted dark:border-zinc-800 dark:bg-zinc-900">
                已用 <code className="font-mono">README.md</code> 作为 Overview。
              </div>
            ) : (
              <RichTextEditor
                value={overview}
                onChange={setOverview}
                placeholder="介绍用途、关键能力、适用场景…"
                ariaLabel="Overview"
                maxHeight={320}
              />
            )}
            {mode === 'create' && readme && (
              <label className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={useReadme}
                  onChange={(e) => setUseReadme(e.target.checked)}
                  className="h-3.5 w-3.5 accent-accent-500"
                />
                用上传包里的 README.md 作为 Overview
              </label>
            )}
          </Field>

          <Field label="标签" ai={aiBtn('tags')}>
            <TagInput value={tags} onChange={setTags} placeholder="逗号/回车分隔，如 pdf, forms" />
          </Field>

          <Field label="可见性 / 访问权限">
            <VisibilitySelector value={visibility} onChange={setVisibility} />
          </Field>

          {mode === 'edit' && (
            <Field label="状态">
              <div className="flex gap-2">
                {(['draft', 'published', 'archived'] as SkillStatus[]).map((s) => (
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
          )}
        </div>

        {/* Advanced — collapsed by default */}
        <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium"
          >
            <ChevronRight className={`h-4 w-4 transition ${advancedOpen ? 'rotate-90' : ''}`} />
            高级选项
            <span className="text-xs font-normal text-muted">Slug · 触发词 · 许可证 · Token</span>
          </button>
          {advancedOpen && (
            <div className="space-y-3 border-t border-zinc-200 p-4 dark:border-zinc-800">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label={mode === 'edit' ? 'Slug（不可改）' : 'Slug'}>
                  <input
                    value={slug}
                    onChange={(e) => setSlug(slugify(e.target.value))}
                    readOnly={mode === 'edit'}
                    disabled={mode === 'edit'}
                    className="input font-mono text-xs disabled:text-muted"
                  />
                </Field>
                <Field label="许可证">
                  <select value={license} onChange={(e) => setLicense(e.target.value)} className="input">
                    {LICENSES.map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="触发词" ai={aiBtn('triggers')}>
                <TagInput value={triggers} onChange={setTriggers} placeholder="用户说什么时该用它" mono />
              </Field>
              <Field label="Token 成本" ai={aiBtn('tokens', 'AI 估算')}>
                <input
                  type="number"
                  min={0}
                  max={50000}
                  step={100}
                  value={tokenCost || ''}
                  onChange={(e) => setTokenCost(Number(e.target.value) || 0)}
                  placeholder="如 1200"
                  className="input max-w-[180px] font-mono tabular-nums"
                />
              </Field>
            </div>
          )}
        </div>

        {/* Actions live ABOVE the upload area so a long staged-file list never
            pushes 发布/存为草稿 out of view. */}
        <div className="flex items-center justify-end gap-2 pt-1">
          {mode === 'create' ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => submitCreate(false)}
                className="rounded-lg border border-zinc-300 px-4 py-1.5 text-sm transition hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                存为草稿
              </button>
              <button
                type="button"
                disabled={pending || !skillMdPresent}
                onClick={() => submitCreate(true)}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
              >
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                发布
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={submitEdit}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              保存
            </button>
          )}
        </div>

        {/* Upload area — create only (new versions are uploaded from the 版本 tab).
            Kept at the very bottom: the staged-file list can get long. */}
        {mode === 'create' && <FileDropZone staged={staged} onChange={onStagedChange} />}

        <style jsx>{`
          .input {
            width: 100%;
            min-height: 2.5rem;
            padding: 0.5rem 0.75rem;
            border-radius: 0.5rem;
            border: 1px solid rgb(var(--border));
            background: rgb(var(--surface));
            font-size: 0.875rem;
            color: rgb(var(--text));
            transition: border-color 150ms;
          }
          .input:focus {
            border-color: rgb(var(--accent));
            outline: none;
            box-shadow: 0 0 0 3px rgb(var(--accent) / 0.15);
          }
        `}</style>
      </div>

      {/* Live preview */}
      <aside className="surface h-fit space-y-3 rounded-2xl p-4 text-sm">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">实时预览</div>
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h4 className="truncate font-semibold">{name || '<未命名>'}</h4>
          <p className="mt-1 line-clamp-2 text-xs text-muted">{summary || '<一句话描述>'}</p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {tokenCost > 0 && <TokenCostBadge tokens={tokenCost} compact />}
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-muted dark:bg-zinc-800">
              {visibility === 'public' ? '公开' : visibility === 'restricted' ? '受限' : '私密'}
            </span>
          </div>
          {tags.length > 0 && (
            <div className="mt-2 font-mono text-[11px] text-muted">{tags.join(' · ')}</div>
          )}
        </div>
      </aside>

      {/* Fullscreen overview editor — same controlled `overview` state, so edits
          stay in sync with the inline editor. */}
      {overviewExpanded && !readmeOverviewActive && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOverviewExpanded(false)}
          onKeyDown={(e) => e.key === 'Escape' && setOverviewExpanded(false)}
        >
          <div
            className="surface flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <span className="text-sm font-semibold">编辑 Overview / 公开简介</span>
              <button
                type="button"
                onClick={() => setOverviewExpanded(false)}
                className="rounded-lg bg-accent-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-600"
              >
                完成
              </button>
            </div>
            <div className="flex-1 overflow-hidden p-4">
              <RichTextEditor
                value={overview}
                onChange={setOverview}
                placeholder="介绍用途、关键能力、适用场景…"
                ariaLabel="Overview 全屏编辑"
                maxHeight="calc(85vh - 10rem)"
                autoFocus
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  ai,
  hint,
  children,
}: {
  label: string;
  ai?: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  // NOT a <label>: the AI chip is a <button> (a labelable element); wrapping it in
  // a <label> made clicks on the field area forward to it and fire generation
  // unintentionally. A <div> keeps the button click-only.
  return (
    <div className="block">
      <span className="mb-1.5 flex items-center justify-between gap-2 text-xs font-medium text-muted">
        <span>{label}</span>
        {ai}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </div>
  );
}
