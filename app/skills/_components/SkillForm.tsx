'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ChevronRight, Maximize2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
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
// pick one explicitly (no pre-selection). Labels come from the `source` namespace.
const SOURCE_VALUES: SourceType[] = ['external', 'curated', 'internal'];

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
  const t = useTranslations('skills_misc');
  const tc = useTranslations('common');
  const tl = useTranslations('labels');
  const tUp = useTranslations('upload');
  const tSrc = useTranslations('source');
  const tSet = useTranslations('settings');
  const tb = useTranslations('browse');

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
        pushToast('error', t('assist_no_content'));
        return;
      }
      const result = await requestAssist(
        {
          action,
          skillMd: content.skillMd,
          readme: content.readme,
          files: content.files,
          current: { name, summary, descriptionMd: overview, tags, triggers },
        },
        {
          no_content: t('assist_no_content'),
          network: t('assist_network_error'),
          unconfigured: t('assist_unconfigured'),
          rate_limited: t('assist_rate_limited'),
          failed: t('assist_failed'),
        },
      );
      applyResult(action, result);
      pushToast('success', action === 'autofill' ? t('ai_autofill_done') : t('ai_generate_done'));
    } catch (e) {
      pushToast('error', (e as AssistError)?.message ?? t('assist_failed'));
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
      pushToast('error', t('err_missing_skill_md'));
      return;
    }
    if (!name.trim() || !summary.trim()) {
      pushToast('error', t('err_name_summary_required'));
      return;
    }
    if (!sourceType) {
      pushToast('error', t('err_source_required'));
      return;
    }
    startTransition(async () => {
      const zip = await buildZip(staged);
      if (zip.size > MAX_PACKAGE_BYTES) {
        pushToast('error', t('err_package_too_large', { size: (zip.size / 1024 / 1024).toFixed(1) }));
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
          slug_taken: t('err_slug_taken', { slug: data.slug }),
          too_large: t('err_too_large'),
          parse_failed: t('err_parse_failed', { reason: data.reason ?? '' }),
          invalid_version: t('err_invalid_version', { version: data.version ?? '' }),
        };
        pushToast('error', reasons[data.error] ?? data.error ?? tSet('upload_failed'));
        return;
      }
      pushToast('success', publish ? tl('skillStatus.published') : t('toast_saved_draft'));
      router.push(publish ? `/skills/${data.skill.slug}` : `/skills/${data.skill.slug}/manage`);
      router.refresh();
    });
  }

  function submitEdit() {
    if (!initial) return;
    if (!name.trim() || !summary.trim()) {
      pushToast('error', t('err_name_summary_required'));
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
        pushToast('error', data.error ?? tSet('save_failed'));
        return;
      }
      pushToast('success', tc('saved'));
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
            <Field label={tUp('name')} ai={aiBtn('name')}>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (mode === 'create' && !slug) setSlug(slugify(e.target.value));
                }}
                className="input"
                placeholder={t('form_name_placeholder')}
              />
            </Field>
            <Field label={tUp('category')}>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input">
                <option value="">{t('uncategorized')}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field
            label={t('field_source_type')}
            hint={mode === 'create' ? t('source_required_hint') : undefined}
          >
            <div className="flex gap-2">
              {SOURCE_VALUES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setSourceType(v)}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-sm transition ${
                    sourceType === v
                      ? 'border-accent-500 bg-accent-500/10 text-accent-700 dark:text-accent-300'
                      : 'border-zinc-300 hover:border-zinc-400 dark:border-zinc-700'
                  }`}
                >
                  {tSrc(v)}
                </button>
              ))}
            </div>
          </Field>

          <Field label={tUp('description')} ai={aiBtn('summary')}>
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value.slice(0, 140))}
              maxLength={140}
              className="input"
              placeholder={t('form_summary_placeholder')}
            />
          </Field>

          <Field
            label={t('field_overview')}
            ai={
              <span className="flex items-center gap-1.5">
                {!readmeOverviewActive && (
                  <button
                    type="button"
                    onClick={() => setOverviewExpanded(true)}
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  >
                    <Maximize2 className="h-3 w-3" />
                    {t('fullscreen_edit')}
                  </button>
                )}
                {aiBtn('overview', t('ai_generate'))}
              </span>
            }
          >
            {readmeOverviewActive ? (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-muted dark:border-zinc-800 dark:bg-zinc-900">
                {t.rich('overview_from_readme', {
                  code: (chunks) => <code className="font-mono">{chunks}</code>,
                })}
              </div>
            ) : (
              <RichTextEditor
                value={overview}
                onChange={setOverview}
                placeholder={t('overview_placeholder')}
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
                {t('use_readme_label')}
              </label>
            )}
          </Field>

          <Field label={tUp('tags')} ai={aiBtn('tags')}>
            <TagInput value={tags} onChange={setTags} placeholder={t('tags_placeholder')} />
          </Field>

          <Field label={t('field_visibility')}>
            <VisibilitySelector value={visibility} onChange={setVisibility} />
          </Field>

          {mode === 'edit' && (
            <Field label={t('field_status')}>
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
                    {tl(`skillStatus.${s}`)}
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
            {t('advanced_options')}
            <span className="text-xs font-normal text-muted">{t('advanced_hint')}</span>
          </button>
          {advancedOpen && (
            <div className="space-y-3 border-t border-zinc-200 p-4 dark:border-zinc-800">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label={mode === 'edit' ? t('slug_readonly') : tUp('slug')}>
                  <input
                    value={slug}
                    onChange={(e) => setSlug(slugify(e.target.value))}
                    readOnly={mode === 'edit'}
                    disabled={mode === 'edit'}
                    className="input font-mono text-xs disabled:text-muted"
                  />
                </Field>
                <Field label={tUp('license_label')}>
                  <select value={license} onChange={(e) => setLicense(e.target.value)} className="input">
                    {LICENSES.map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label={tUp('triggers')} ai={aiBtn('triggers')}>
                <TagInput
                  value={triggers}
                  onChange={setTriggers}
                  placeholder={t('triggers_placeholder')}
                  mono
                />
              </Field>
              <Field label={tb('token_cost_label')} ai={aiBtn('tokens', t('ai_estimate'))}>
                <input
                  type="number"
                  min={0}
                  max={50000}
                  step={100}
                  value={tokenCost || ''}
                  onChange={(e) => setTokenCost(Number(e.target.value) || 0)}
                  placeholder={t('token_cost_placeholder')}
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
                {t('btn_save_draft')}
              </button>
              <button
                type="button"
                disabled={pending || !skillMdPresent}
                onClick={() => submitCreate(true)}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
              >
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {tUp('publish')}
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
              {tc('save')}
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
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">
          {t('live_preview')}
        </div>
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h4 className="truncate font-semibold">{name || t('preview_untitled')}</h4>
          <p className="mt-1 line-clamp-2 text-xs text-muted">
            {summary || t('preview_no_summary')}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {tokenCost > 0 && <TokenCostBadge tokens={tokenCost} compact />}
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-muted dark:bg-zinc-800">
              {tl(`visibility.${visibility}`)}
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
              <span className="text-sm font-semibold">{t('edit_overview_title')}</span>
              <button
                type="button"
                onClick={() => setOverviewExpanded(false)}
                className="rounded-lg bg-accent-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-600"
              >
                {t('done')}
              </button>
            </div>
            <div className="flex-1 overflow-hidden p-4">
              <RichTextEditor
                value={overview}
                onChange={setOverview}
                placeholder={t('overview_placeholder')}
                ariaLabel={t('overview_fullscreen_aria')}
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
