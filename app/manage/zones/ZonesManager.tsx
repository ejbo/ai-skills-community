'use client';

// 技术专区管理表（/manage 全站中文，不走 i18n —— 与其他 manage 页一致）。
//
// 写操作全部走 /api/admin/zones/*（A1 的后台路由：gateApi('zones') + logAdmin）：
//   POST   /api/admin/zones            { name, slug, ownerHandle, lab, department, tagline }
//   PATCH  /api/admin/zones/[id]       { featured? } | { restore: true } | { ownerHandle }
//   DELETE /api/admin/zones/[id]       软删除
// 表格包含已软删除的行（默认折叠，「显示已删除」勾选后可见并提供「恢复」）。

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, ExternalLink, Loader2, Plus, RotateCcw, Search, Star, Trash2, X } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import { ZONE_LIMITS, ZONE_SLUG_MAX, ZONE_SLUG_MIN, isValidZoneSlug, slugifyAscii } from '@/lib/zones/shared';

export interface ZoneAdminRow {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  lab: string;
  department: string;
  visibility: 'public' | 'members';
  joinPolicy: 'open' | 'approval' | 'invite';
  featured: boolean;
  memberCount: number;
  postCount: number;
  lastActivityAtText: string;
  createdAtText: string;
  /** null ⇒ 在线；有值 ⇒ 已软删除（前台不可见）。 */
  deletedAtText: string | null;
  owner: { handle: string; displayName: string };
}

const VISIBILITY_LABEL: Record<ZoneAdminRow['visibility'], string> = { public: '公开', members: '仅成员' };
const JOIN_LABEL: Record<ZoneAdminRow['joinPolicy'], string> = { open: '自由加入', approval: '需审核', invite: '仅邀请' };

// API 错误码 → 中文（reason 优先；未知码原样附在括号里，方便排查）。
const ERROR_MESSAGES: Record<string, string> = {
  invalid_input: '输入不合法，请检查各字段',
  slug_taken: '该 Slug 已被其他版块占用',
  slug_invalid: 'Slug 格式不正确（3–40 位小写字母、数字、中划线）',
  invalid_slug: 'Slug 格式不正确（3–40 位小写字母、数字、中划线）',
  user_not_found: '未找到该用户，请填写用户的 handle',
  owner_not_found: '未找到该用户，请填写用户的 handle',
  owner_not_member: '该用户不是版块的在线成员，无法转让',
  not_member: '该用户不是版块的在线成员，无法转让',
  same_owner: '该用户已经是主版主',
  user_disabled: '该用户已被停用',
  not_found: '版块不存在',
  zone_deleted: '版块已删除，请先恢复',
  forbidden: '没有权限执行此操作',
  unauthenticated: '登录已失效，请重新登录',
  conflict: '操作冲突，请重试',
  rate_limited: '操作太频繁，请稍后再试',
};

function errorMessage(data: unknown, fallback: string): string {
  const d = (data && typeof data === 'object' ? data : {}) as { error?: unknown; reason?: unknown };
  if (typeof d.reason === 'string' && d.reason.trim()) return d.reason;
  const code = typeof d.error === 'string' ? d.error : '';
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  return code ? `${fallback}（${code}）` : fallback;
}

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

const iconBtn =
  'flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-100';

export function ZonesManager({ items, labs, departments }: { items: ZoneAdminRow[]; labs: string[]; departments: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [creating, setCreating] = useState(false);

  const deletedCount = useMemo(() => items.filter((z) => z.deletedAtText).length, [items]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((z) => {
      if (!showDeleted && z.deletedAtText) return false;
      if (!needle) return true;
      return [z.name, z.slug, z.tagline, z.lab, z.department, z.owner.handle, z.owner.displayName]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [items, q, showDeleted]);

  function mutate(id: string, url: string, init: RequestInit, okMsg: string, failMsg: string) {
    setBusyId(id);
    startTransition(async () => {
      try {
        const res = await fetch(url, init);
        if (!res.ok) {
          pushToast('error', errorMessage(await readJson(res), failMsg));
          return;
        }
        pushToast('success', okMsg);
        router.refresh();
      } catch {
        pushToast('error', `${failMsg}，请稍后再试`);
      } finally {
        setBusyId(null);
      }
    });
  }

  function patch(row: ZoneAdminRow, body: Record<string, unknown>, okMsg: string, failMsg: string) {
    mutate(
      row.id,
      `/api/admin/zones/${row.id}`,
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      okMsg,
      failMsg,
    );
  }

  function transfer(row: ZoneAdminRow) {
    const raw = window.prompt(
      `将「${row.name}」的主版主转让给哪位用户？\n请输入对方的 handle（当前主版主：@${row.owner.handle}）。\n对方必须已是该版块的在线成员；原主版主会保留为版主。`,
      '',
    );
    if (raw === null) return;
    const handle = raw.trim().replace(/^@/, '');
    if (!handle) {
      pushToast('error', '请输入用户 handle');
      return;
    }
    if (handle.toLowerCase() === row.owner.handle.toLowerCase()) {
      pushToast('error', '该用户已经是主版主');
      return;
    }
    patch(row, { ownerHandle: handle }, `已将主版主转让给 @${handle}`, '转让失败');
  }

  function remove(row: ZoneAdminRow) {
    if (!window.confirm(`删除「${row.name}」？版块及其帖子 / Wiki 将从前台移除（软删除，可在此恢复）。`)) return;
    mutate(row.id, `/api/admin/zones/${row.id}`, { method: 'DELETE' }, '已删除', '删除失败');
  }

  const inputCls =
    'h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-600';

  return (
    <div className="space-y-4">
      <div className="surface flex flex-wrap items-center gap-2 rounded-xl p-2">
        <label className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索版块名、Slug、主版主、研究所、部门…"
            className={`${inputCls} w-full pl-8`}
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              aria-label="清空"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
        <label className="flex h-9 cursor-pointer select-none items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs text-muted dark:border-zinc-800">
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={(e) => setShowDeleted(e.target.checked)}
            className="h-3.5 w-3.5 accent-zinc-900 dark:accent-zinc-100"
          />
          显示已删除{deletedCount > 0 ? `（${deletedCount}）` : ''}
        </label>
        <span className="px-1 text-xs text-muted">显示 {visible.length} 个</span>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="ml-auto flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white"
        >
          <Plus className="h-4 w-4" />
          新建版块
        </button>
      </div>

      {creating && (
        <CreatePanel
          labs={labs}
          departments={departments}
          onDone={() => {
            setCreating(false);
            router.refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      <div className="surface overflow-x-auto rounded-2xl">
        <table className="w-full min-w-[1120px] text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-muted dark:border-zinc-800">
              <th className="px-3 py-2.5 font-medium">版块</th>
              <th className="px-3 py-2.5 font-medium">主版主</th>
              <th className="px-3 py-2.5 font-medium">研究所 · 部门</th>
              <th className="px-3 py-2.5 font-medium">可见性</th>
              <th className="px-3 py-2.5 font-medium">加入方式</th>
              <th className="px-3 py-2.5 text-right font-medium">成员</th>
              <th className="px-3 py-2.5 text-right font-medium">帖子</th>
              <th className="px-3 py-2.5 font-medium">最近活跃</th>
              <th className="px-3 py-2.5 font-medium">创建</th>
              <th className="px-3 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const deleted = !!row.deletedAtText;
              const busy = pending && busyId === row.id;
              return (
                <tr
                  key={row.id}
                  className={`border-b border-zinc-100 last:border-0 dark:border-zinc-900 ${deleted ? 'opacity-60' : ''}`}
                >
                  <td className="max-w-[280px] px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {row.featured && !deleted && (
                        <Star className="h-3.5 w-3.5 shrink-0 fill-zinc-900 text-zinc-900 dark:fill-zinc-100 dark:text-zinc-100" />
                      )}
                      <span className="truncate font-medium">{row.name}</span>
                      {deleted && (
                        <span className="shrink-0 rounded-full border border-zinc-300 px-1.5 py-px text-[10px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                          已删除
                        </span>
                      )}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted">/zones/{row.slug}</div>
                    {row.tagline && <div className="truncate text-xs text-muted">{row.tagline}</div>}
                    {deleted && <div className="text-[11px] text-muted">删除于 {row.deletedAtText}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-muted">
                    {row.owner.displayName}
                    <span className="ml-1 text-xs">@{row.owner.handle}</span>
                  </td>
                  <td className="max-w-[200px] px-3 py-2.5 text-xs text-muted">
                    {[row.lab, row.department].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
                      {VISIBILITY_LABEL[row.visibility]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted">{JOIN_LABEL[row.joinPolicy]}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">{row.memberCount}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">{row.postCount}</td>
                  <td className="px-3 py-2.5 font-mono text-[11px] tabular-nums text-muted">{row.lastActivityAtText}</td>
                  <td className="px-3 py-2.5 font-mono text-[11px] tabular-nums text-muted">{row.createdAtText}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
                      <a
                        href={withBasePath(`/zones/${row.slug}`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="打开版块（新标签页）"
                        className={iconBtn}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                      {deleted ? (
                        <button
                          type="button"
                          disabled={busy}
                          title="恢复版块"
                          onClick={() => patch(row, { restore: true }, '已恢复', '恢复失败')}
                          className={iconBtn}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            title={row.featured ? '取消精选' : '设为精选'}
                            onClick={() =>
                              patch(
                                row,
                                { featured: !row.featured },
                                row.featured ? '已取消精选' : '已设为精选',
                                '操作失败',
                              )
                            }
                            className={iconBtn}
                          >
                            <Star
                              className={`h-4 w-4 ${
                                row.featured ? 'fill-zinc-900 text-zinc-900 dark:fill-zinc-100 dark:text-zinc-100' : ''
                              }`}
                            />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            title="转让主版主"
                            onClick={() => transfer(row)}
                            className={iconBtn}
                          >
                            <ArrowLeftRight className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            title="删除（软删除）"
                            onClick={() => remove(row)}
                            className={`${iconBtn} hover:!text-danger`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-sm text-muted">
                  {items.length === 0 ? '还没有版块，点「新建版块」创建第一个' : '没有匹配的版块'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface CreateForm {
  name: string;
  slug: string;
  ownerHandle: string;
  lab: string;
  department: string;
  tagline: string;
}

function CreatePanel({
  labs,
  departments,
  onDone,
  onCancel,
}: {
  labs: string[];
  departments: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<CreateForm>({ name: '', slug: '', ownerHandle: '', lab: '', department: '', tagline: '' });
  // 中文名 slugify 后可能为空 —— 一旦管理员手改过 slug 就不再跟随名称。
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  function setName(name: string) {
    setForm((f) => ({ ...f, name, slug: slugTouched ? f.slug : slugifyAscii(name) }));
  }

  const slugOk = form.slug === '' || isValidZoneSlug(form.slug);

  async function submit() {
    const name = form.name.trim();
    const slug = form.slug.trim().toLowerCase();
    const ownerHandle = form.ownerHandle.trim().replace(/^@/, '');
    if (name.length < ZONE_LIMITS.nameMin || name.length > ZONE_LIMITS.nameMax) {
      pushToast('error', `版块名称需为 ${ZONE_LIMITS.nameMin}–${ZONE_LIMITS.nameMax} 个字符`);
      return;
    }
    if (!isValidZoneSlug(slug)) {
      pushToast('error', `Slug 需为 ${ZONE_SLUG_MIN}–${ZONE_SLUG_MAX} 位小写字母、数字或中划线，且不能是保留字`);
      return;
    }
    if (!ownerHandle) {
      pushToast('error', '请填写主版主的 handle');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/zones', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          slug,
          ownerHandle,
          lab: form.lab.trim(),
          department: form.department.trim(),
          tagline: form.tagline.trim(),
        }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        pushToast('error', errorMessage(data, '创建失败'));
        return;
      }
      pushToast('success', `已创建版块「${name}」`);
      onDone();
    } catch {
      pushToast('error', '创建失败，请稍后再试');
    } finally {
      setSaving(false);
    }
  }

  const input =
    'h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-600';
  const label = 'mb-1.5 block text-xs font-medium text-muted';

  return (
    <div className="surface space-y-3 rounded-xl p-4">
      <div>
        <h3 className="text-sm font-semibold">新建版块</h3>
        <p className="mt-0.5 text-xs text-muted">
          代指定用户创建版块：对方成为主版主，系统角色（版主 / 作者 / 成员）自动生成；简介、封面、可见性等由主版主在「版块设置」里完善。
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>
            版块名称 <span className="text-danger">*</span>
          </label>
          <input
            value={form.name}
            onChange={(e) => setName(e.target.value)}
            maxLength={ZONE_LIMITS.nameMax}
            placeholder="如：大模型推理加速"
            className={input}
          />
        </div>
        <div>
          <label className={label}>
            Slug <span className="text-danger">*</span>
          </label>
          <input
            value={form.slug}
            onChange={(e) => {
              setSlugTouched(true);
              setForm({ ...form, slug: e.target.value.toLowerCase() });
            }}
            maxLength={ZONE_SLUG_MAX}
            placeholder="如：llm-inference"
            className={`${input} font-mono ${slugOk ? '' : '!border-danger'}`}
          />
          <p className="mt-1 text-[11px] text-muted">
            访问地址 /zones/{form.slug || '…'}；{ZONE_SLUG_MIN}–{ZONE_SLUG_MAX} 位小写字母、数字、中划线（中文名称需手填）。
          </p>
        </div>
        <div>
          <label className={label}>
            主版主 handle <span className="text-danger">*</span>
          </label>
          <input
            value={form.ownerHandle}
            onChange={(e) => setForm({ ...form, ownerHandle: e.target.value })}
            placeholder="如：zhangsan（用户主页 /users/zhangsan 的那个）"
            className={`${input} font-mono`}
          />
        </div>
        <div>
          <label className={label}>一句话简介</label>
          <input
            value={form.tagline}
            onChange={(e) => setForm({ ...form, tagline: e.target.value })}
            maxLength={ZONE_LIMITS.taglineMax}
            placeholder="可选，最多 80 字"
            className={input}
          />
        </div>
        <div>
          <label className={label}>研究所</label>
          <input
            value={form.lab}
            onChange={(e) => setForm({ ...form, lab: e.target.value })}
            list="zone-create-labs"
            maxLength={ZONE_LIMITS.labMax}
            placeholder="可选，如：计算视觉研究所"
            className={input}
          />
          <datalist id="zone-create-labs">
            {labs.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </div>
        <div>
          <label className={label}>部门</label>
          <input
            value={form.department}
            onChange={(e) => setForm({ ...form, department: e.target.value })}
            list="zone-create-departments"
            maxLength={ZONE_LIMITS.departmentMax}
            placeholder="可选，如：AI事业部"
            className={input}
          />
          <datalist id="zone-create-departments">
            {departments.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-9 rounded-lg border border-zinc-200 px-4 text-sm text-muted hover:text-zinc-800 dark:border-zinc-800 dark:hover:text-zinc-200"
        >
          取消
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          创建
        </button>
      </div>
    </div>
  );
}
