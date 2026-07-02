'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  ImagePlus,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { RichTextEditor } from '@/components/RichTextEditor';
import { AiFieldButton } from '@/app/skills/_components/AiButton';
import { requestAssist, type AssistError } from '@/app/skills/_components/assist-client';
import { withBasePath } from '@/lib/base-path';
import { isIconImage } from '@/lib/pack-icon';

interface PackSkillRow {
  id: string;
  slug: string;
  name: string;
  summary: string;
  visibility: string;
  eligible: boolean;
}

interface PackRow {
  id: string;
  slug: string;
  name: string;
  summary: string;
  descriptionMd: string;
  icon: string;
  isPublished: boolean;
  sortOrder: number;
  installCount: number;
  skills: PackSkillRow[];
}

interface Draft {
  id: string | null; // null = creating
  slug: string;
  name: string;
  summary: string;
  descriptionMd: string;
  icon: string;
  isPublished: boolean;
  sortOrder: number;
  skills: PackSkillRow[];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

const emptyDraft: Draft = {
  id: null,
  slug: '',
  name: '',
  summary: '',
  descriptionMd: '',
  icon: '',
  isPublished: false,
  sortOrder: 0,
  skills: [],
};

export function PackManager({ packs, aiEnabled }: { packs: PackRow[]; aiEnabled: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, startTransition] = useTransition();
  // Set by the open editor; guards actions that would silently discard edits.
  const dirtyRef = useRef(false);
  const onDirty = useCallback((d: boolean) => {
    dirtyRef.current = d;
  }, []);
  const confirmDiscard = () => !dirtyRef.current || confirm('编辑器中有未保存的修改，确定放弃？');

  function togglePublish(pack: PackRow) {
    startTransition(async () => {
      const res = await fetch(`/api/admin/packs/${pack.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isPublished: !pack.isPublished }),
      });
      if (!res.ok) {
        pushToast('error', '操作失败');
        return;
      }
      pushToast('success', pack.isPublished ? '已下架' : '已发布');
      router.refresh();
    });
  }

  function remove(pack: PackRow) {
    if (!confirm(`确定删除合集包「${pack.name}」？包内的 skills 本身不受影响。`)) return;
    startTransition(async () => {
      const res = await fetch(`/api/admin/packs/${pack.id}`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', '删除失败');
        return;
      }
      pushToast('success', '已删除');
      if (draft?.id === pack.id) {
        dirtyRef.current = false;
        setDraft(null);
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {!draft && (
        <button
          onClick={() => setDraft(emptyDraft)}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white hover:bg-accent-600"
        >
          <Plus className="h-3.5 w-3.5" />
          新建合集包
        </button>
      )}

      {draft && (
        <PackEditor
          key={draft.id ?? 'new'}
          initial={draft}
          aiEnabled={aiEnabled}
          onDirty={onDirty}
          onClose={() => {
            if (!confirmDiscard()) return;
            dirtyRef.current = false;
            setDraft(null);
          }}
          onSaved={() => {
            dirtyRef.current = false;
            setDraft(null);
            router.refresh();
          }}
        />
      )}

      <div className="surface overflow-hidden rounded-xl">
        <table className="data">
          <thead>
            <tr>
              <th>名称</th>
              <th>Slug</th>
              <th>Skills</th>
              <th>安装</th>
              <th>状态</th>
              <th>排序</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {packs.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-xs text-muted">
                  还没有合集包 —— 点击上方「新建合集包」创建第一个
                </td>
              </tr>
            )}
            {packs.map((p) => {
              const broken = p.skills.filter((s) => !s.eligible).length;
              return (
                <tr key={p.id}>
                  <td>
                    <span className="flex items-center gap-1.5">
                      {p.icon &&
                        (isIconImage(p.icon) ? (
                          <img
                            src={withBasePath(p.icon)}
                            alt=""
                            className="h-5 w-5 rounded object-cover"
                          />
                        ) : (
                          <span>{p.icon}</span>
                        ))}
                      <span className="font-medium">{p.name}</span>
                    </span>
                  </td>
                  <td className="font-mono text-[11px] text-muted">{p.slug}</td>
                  <td className="font-mono text-[11px] tabular-nums">
                    {p.skills.length}
                    {broken > 0 && (
                      <span title={`${broken} 个成员已不可安装（已下架/私密/删除）`} className="ml-1 inline-flex items-center text-amber-600">
                        <TriangleAlert className="h-3 w-3" />
                      </span>
                    )}
                  </td>
                  <td className="font-mono text-[11px] tabular-nums">{p.installCount}</td>
                  <td>
                    {p.isPublished ? (
                      <span className="badge" style={{ background: '#dcfce7', color: '#166534' }}>已发布</span>
                    ) : (
                      <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>草稿</span>
                    )}
                  </td>
                  <td className="font-mono text-[11px] tabular-nums">{p.sortOrder}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          if (draft && !confirmDiscard()) return;
                          dirtyRef.current = false;
                          setDraft({ ...p, id: p.id, skills: [...p.skills] });
                        }}
                        className="flex h-6 items-center rounded border border-zinc-200 px-2 text-[11px] hover:border-accent-500 hover:text-accent-600 dark:border-zinc-700"
                      >
                        编辑
                      </button>
                      <Link
                        href={`/packs/${p.slug}`}
                        target="_blank"
                        className="flex h-6 items-center gap-0.5 rounded border border-zinc-200 px-2 text-[11px] hover:border-accent-500 hover:text-accent-600 dark:border-zinc-700"
                      >
                        <ExternalLink className="h-3 w-3" />
                        预览
                      </Link>
                      {/* Row actions on the pack being edited are locked — the
                          editor would otherwise PUT its stale snapshot on save
                          and silently revert them. */}
                      <button
                        onClick={() => togglePublish(p)}
                        disabled={pending || draft?.id === p.id}
                        className="flex h-6 items-center rounded border border-zinc-200 px-2 text-[11px] hover:border-accent-500 hover:text-accent-600 disabled:opacity-60 dark:border-zinc-700"
                      >
                        {p.isPublished ? '下架' : '发布'}
                      </button>
                      <button
                        onClick={() => remove(p)}
                        disabled={pending || draft?.id === p.id}
                        className="flex h-6 items-center gap-1 rounded border border-danger/40 px-2 text-[11px] text-danger hover:bg-danger/10 disabled:opacity-60"
                      >
                        <Trash2 className="h-3 w-3" />
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PackEditor({
  initial,
  aiEnabled,
  onDirty,
  onClose,
  onSaved,
}: {
  initial: Draft;
  aiEnabled: boolean;
  onDirty: (dirty: boolean) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [slugTouched, setSlugTouched] = useState(Boolean(initial.slug));
  const [saving, startSaving] = useTransition();
  const savingRef = useRef(false); // useTransition's flag doesn't span the await
  const [aiLoading, setAiLoading] = useState(false);
  const [iconUploading, setIconUploading] = useState(false);
  const iconFileRef = useRef<HTMLInputElement>(null);

  const creating = draft.id === null;
  const brokenMembers = draft.skills.filter((s) => !s.eligible);

  useEffect(() => {
    onDirty(
      draft.name !== initial.name ||
        draft.slug !== initial.slug ||
        draft.summary !== initial.summary ||
        draft.descriptionMd !== initial.descriptionMd ||
        draft.icon !== initial.icon ||
        draft.isPublished !== initial.isPublished ||
        draft.sortOrder !== initial.sortOrder ||
        draft.skills.map((s) => s.id).join(',') !== initial.skills.map((s) => s.id).join(','),
    );
  }, [draft, initial, onDirty]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function moveSkill(index: number, delta: -1 | 1) {
    setDraft((d) => {
      const next = [...d.skills];
      const j = index + delta;
      if (j < 0 || j >= next.length) return d;
      [next[index], next[j]] = [next[j], next[index]];
      return { ...d, skills: next };
    });
  }

  async function uploadIcon(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setIconUploading(true);
    try {
      const res = await fetch('/api/uploads/image', {
        method: 'POST',
        headers: { 'content-type': file.type, 'x-filename': encodeURIComponent(file.name) },
        body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        pushToast('error', data.error === 'file_too_large' ? '图片太大' : '上传失败');
        return;
      }
      set('icon', data.url as string);
    } catch {
      pushToast('error', '上传失败，请重试');
    } finally {
      setIconUploading(false);
    }
  }

  async function generateIntro() {
    const members = draft.skills.filter((s) => s.eligible);
    setAiLoading(true);
    try {
      const r = await requestAssist({
        action: 'pack',
        packSkills: members.map((s) => ({ name: s.name, summary: s.summary })),
        current: { name: draft.name || undefined },
      });
      setDraft((d) => ({
        ...d,
        name: d.name || (r.name ?? ''),
        summary: r.summary ?? d.summary,
        descriptionMd: r.descriptionMd ?? d.descriptionMd,
      }));
      pushToast('success', 'AI 已生成介绍，可以继续编辑');
    } catch (e) {
      pushToast('error', (e as AssistError).message ?? 'AI 生成失败');
    } finally {
      setAiLoading(false);
    }
  }

  function save() {
    if (!draft.name.trim()) {
      pushToast('error', '请填写名称');
      return;
    }
    if (creating && !draft.slug) {
      pushToast('error', '请填写 slug');
      return;
    }
    const skillIds = draft.skills.filter((s) => s.eligible).map((s) => s.id);
    if (draft.isPublished && skillIds.length === 0) {
      if (!confirm('这个合集包没有可安装的 skill，发布后用户会看到一个空包。确定继续？')) return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    startSaving(async () => {
      try {
        const payload = {
          name: draft.name.trim(),
          summary: draft.summary.trim(),
          descriptionMd: draft.descriptionMd,
          icon: draft.icon.trim(),
          isPublished: draft.isPublished,
          sortOrder: draft.sortOrder,
          skillIds,
          ...(creating ? { slug: draft.slug } : {}),
        };
        const res = await fetch(creating ? '/api/admin/packs' : `/api/admin/packs/${draft.id}`, {
          method: creating ? 'POST' : 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg =
            data.error === 'slug_taken'
              ? '这个 slug 已被占用'
              : data.error === 'invalid_input'
                ? '输入不合法：请检查名称（≤80 字）、slug 与各项长度'
                : data.reason ?? data.error ?? '保存失败';
          pushToast('error', msg);
          return;
        }
        pushToast('success', creating ? '已创建' : '已保存');
        onSaved();
      } finally {
        savingRef.current = false;
      }
    });
  }

  return (
    <div className="surface space-y-4 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{creating ? '新建合集包' : `编辑：${initial.name}`}</h3>
        <button onClick={onClose} className="rounded p-1 text-muted hover:bg-zinc-100 dark:hover:bg-zinc-800">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted">名称</label>
          <input
            placeholder="例如：办公自动化全家桶"
            value={draft.name}
            maxLength={80}
            onChange={(e) => {
              set('name', e.target.value);
              if (creating && !slugTouched) set('slug', slugify(e.target.value));
            }}
            className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted">
            slug（安装命令 pack:&lt;slug&gt; 用，创建后不可改）
          </label>
          <input
            placeholder="如 office-suite"
            value={draft.slug}
            disabled={!creating}
            onChange={(e) => {
              setSlugTouched(true);
              set('slug', slugify(e.target.value));
            }}
            className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 font-mono text-xs disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted">
            图标（emoji 或上传图片，可选）
          </label>
          <div className="flex items-center gap-2">
            {isIconImage(draft.icon) ? (
              <>
                <img
                  src={withBasePath(draft.icon)}
                  alt="图标预览"
                  className="h-9 w-9 rounded-lg border border-zinc-200 object-cover dark:border-zinc-800"
                />
                <button
                  onClick={() => set('icon', '')}
                  className="h-9 rounded-lg border border-zinc-200 px-3 text-xs text-muted hover:border-danger hover:text-danger dark:border-zinc-700"
                >
                  移除
                </button>
              </>
            ) : (
              <input
                placeholder="📦"
                value={draft.icon}
                onChange={(e) => set('icon', e.target.value.slice(0, 16))}
                className="h-9 w-20 rounded-lg border border-zinc-200 bg-white px-3 text-center text-sm dark:border-zinc-800 dark:bg-zinc-900"
              />
            )}
            <button
              onClick={() => iconFileRef.current?.click()}
              disabled={iconUploading}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs hover:border-accent-500 hover:text-accent-600 disabled:opacity-60 dark:border-zinc-700"
            >
              {iconUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
              上传图片
            </button>
            <input ref={iconFileRef} type="file" accept="image/*" className="hidden" onChange={uploadIcon} />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted">
            排序（列表展示顺序，数字小的靠前）
          </label>
          <input
            type="number"
            value={draft.sortOrder}
            onChange={(e) => set('sortOrder', Number(e.target.value) || 0)}
            className="h-9 w-28 rounded-lg border border-zinc-200 bg-white px-3 text-right font-mono text-xs tabular-nums dark:border-zinc-800 dark:bg-zinc-900"
          />
        </div>
      </div>

      <SkillPicker
        selected={draft.skills}
        onAdd={(s) => setDraft((d) => ({ ...d, skills: [...d.skills, s] }))}
        onRemove={(id) => setDraft((d) => ({ ...d, skills: d.skills.filter((s) => s.id !== id) }))}
        onMove={moveSkill}
      />
      {brokenMembers.length > 0 && (
        <p className="flex items-center gap-1 text-xs text-amber-600">
          <TriangleAlert className="h-3.5 w-3.5" />
          {brokenMembers.map((s) => s.name).join('、')} 已不可安装（已下架/私密/删除），保存时会自动移出。
        </p>
      )}

      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <label className="text-xs font-medium text-muted">一句话简介（列表卡片展示）</label>
          {aiEnabled && (
            <AiFieldButton
              onClick={generateIntro}
              loading={aiLoading}
              disabled={draft.skills.filter((s) => s.eligible).length === 0}
              label="AI 生成介绍"
              title="根据包内 skills 自动撰写一句话简介 + 详细介绍（包含内容 / 适用场景）"
            />
          )}
        </div>
        <input
          placeholder="这个包解决什么场景？（不超过 200 字）"
          value={draft.summary}
          onChange={(e) => set('summary', e.target.value.slice(0, 200))}
          className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted">
          详细介绍（详情页展示：包含内容、适用场景、使用建议）
        </label>
        <RichTextEditor
          value={draft.descriptionMd}
          onChange={(v) => set('descriptionMd', v)}
          variant="full"
          maxLength={40000}
          ariaLabel="合集包介绍"
        />
      </div>

      <div className="flex items-center justify-between">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.isPublished}
            onChange={(e) => set('isPublished', e.target.checked)}
            className="h-4 w-4 accent-accent-500"
          />
          发布（对所有用户可见）
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="h-9 rounded-lg border border-zinc-200 px-4 text-sm dark:border-zinc-700"
          >
            取消
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-60"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {creating ? '创建' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface SearchResult {
  id: string;
  slug: string;
  name: string;
  summary: string;
  visibility: string;
}

function SkillPicker({
  selected,
  onAdd,
  onRemove,
  onMove,
}: {
  selected: PackSkillRow[];
  onAdd: (s: PackSkillRow) => void;
  onRemove: (id: string) => void;
  onMove: (index: number, delta: -1 | 1) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    clearTimeout(timer.current);
    setSearching(true);
    let stale = false; // a newer query superseded this one — drop its response
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/skills?q=${encodeURIComponent(q.trim())}&pageSize=10`);
        const data = await res.json();
        if (!stale) setResults((data.items ?? []) as SearchResult[]);
      } catch {
        if (!stale) setResults([]);
      } finally {
        if (!stale) setSearching(false);
      }
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer.current);
    };
  }, [q]);

  const selectedIds = new Set(selected.map((s) => s.id));

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-muted">
        包内 Skills（{selected.length} 个，按显示/安装顺序排列）
      </label>

      {selected.length > 0 && (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {selected.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2 bg-white px-3 py-1.5 text-sm dark:bg-zinc-900">
              <span className="w-5 text-right font-mono text-[11px] text-muted">{i + 1}.</span>
              <span className={`min-w-0 flex-1 truncate ${s.eligible ? '' : 'text-muted line-through'}`}>
                {s.name}
                <span className="ml-2 font-mono text-[11px] text-muted">{s.slug}</span>
              </span>
              {s.visibility === 'restricted' && (
                <span title="受限下载：用户需申请通过才能安装" className="text-amber-500">
                  <ShieldCheck className="h-3.5 w-3.5" />
                </span>
              )}
              {!s.eligible && <TriangleAlert className="h-3.5 w-3.5 text-amber-600" />}
              <button onClick={() => onMove(i, -1)} disabled={i === 0} className="rounded p-0.5 text-muted hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800">
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => onMove(i, 1)} disabled={i === selected.length - 1} className="rounded p-0.5 text-muted hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800">
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => onRemove(s.id)} className="rounded p-0.5 text-danger hover:bg-danger/10">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <input
          placeholder="搜索已发布的 skill，点击加入合集包…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-9 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        />
        {searching && (
          <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted" />
        )}
      </div>

      {results.length > 0 && (
        <ul className="max-h-56 divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {results.map((r) => {
            const added = selectedIds.has(r.id);
            return (
              <li key={r.id}>
                <button
                  disabled={added}
                  onClick={() => {
                    onAdd({
                      id: r.id,
                      slug: r.slug,
                      name: r.name,
                      summary: r.summary,
                      visibility: r.visibility,
                      eligible: true,
                    });
                    setQ('');
                    setResults([]);
                  }}
                  className="flex w-full items-center gap-2 bg-white px-3 py-2 text-left text-sm hover:bg-accent-50 disabled:opacity-40 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{r.name}</span>
                    <span className="ml-2 font-mono text-[11px] text-muted">{r.slug}</span>
                    {r.summary && <span className="mt-0.5 block truncate text-xs text-muted">{r.summary}</span>}
                  </span>
                  {r.visibility === 'restricted' && (
                    <span className="shrink-0 text-[11px] text-amber-600">受限</span>
                  )}
                  {added ? (
                    <span className="shrink-0 text-[11px] text-muted">已加入</span>
                  ) : (
                    <Plus className="h-3.5 w-3.5 shrink-0 text-accent-500" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
