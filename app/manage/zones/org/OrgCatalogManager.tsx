'use client';

// 组织架构目录编辑器（/manage 全站中文）。研究所一行一条（↑↓ 排序、行内改名、简介、封面
// 地址、版块数、删除），展开后是它的实验室列表（新增 / 改名 / ↑↓ / 删除）。
//
// 写操作全部走 /api/admin/zones/org/*：
//   POST   /org                 { name, description?, imageUrl? }
//   PUT    /org                 { ids }                       研究所排序
//   PATCH  /org/[id]            { name?, description?, imageUrl? }
//   DELETE /org/[id]
//   POST   /org/[id]/labs       { name, description? }
//   PUT    /org/[id]/labs       { ids }                       实验室排序
//   PATCH  /org/labs/[labId]    { name?, description? }
//   DELETE /org/labs/[labId]
// 改名会同步改写版块行（Zone.lab / Zone.department），响应里的 renamedZones 直接进 toast。

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import type { OrgInstituteAdminRow, OrgLabAdminRow } from '@/lib/zones/org-admin';
import { ADMIN_ICON_BTN, ADMIN_INPUT_CLS, ADMIN_PRIMARY_BTN, ADMIN_SECONDARY_BTN, adminJson, moveId } from '../_components/admin-fetch';

const NAME_MAX = 64;
const DESC_MAX = 200;

export function OrgCatalogManager({ items }: { items: OrgInstituteAdminRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set(items.length <= 3 ? items.map((i) => i.id) : []));
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  function run(key: string, work: () => Promise<string | void>, failMsg: string) {
    setBusy(key);
    startTransition(async () => {
      try {
        const msg = await work();
        if (msg) pushToast('success', msg);
        router.refresh();
      } catch (e) {
        pushToast('error', e instanceof Error ? e.message : failMsg);
      } finally {
        setBusy(null);
      }
    });
  }

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function createInstitute() {
    const name = newName.trim();
    if (!name) {
      pushToast('error', '请输入研究所名称');
      return;
    }
    run(
      'create',
      async () => {
        await adminJson('/api/admin/zones/org', { method: 'POST', json: { name, description: newDesc.trim() } }, '新增失败');
        setNewName('');
        setNewDesc('');
        setAdding(false);
        return `已新增「${name}」`;
      },
      '新增失败',
    );
  }

  function reorder(id: string, dir: -1 | 1) {
    const ids = moveId(
      items.map((i) => i.id),
      id,
      dir,
    );
    run(id, async () => {
      await adminJson('/api/admin/zones/org', { method: 'PUT', json: { ids } }, '排序失败');
    }, '排序失败');
  }

  function patchInstitute(row: OrgInstituteAdminRow, patch: { name?: string; description?: string; imageUrl?: string | null }) {
    run(
      row.id,
      async () => {
        const r = await adminJson<{ renamedZones: number }>(`/api/admin/zones/org/${row.id}`, { method: 'PATCH', json: patch }, '保存失败');
        if (patch.name !== undefined && patch.name !== row.name) {
          return r.renamedZones > 0
            ? `已改名为「${patch.name}」，同步更新了 ${r.renamedZones} 个版块`
            : `已改名为「${patch.name}」`;
        }
        return '已保存';
      },
      '保存失败',
    );
  }

  function removeInstitute(row: OrgInstituteAdminRow) {
    const note =
      row.zoneCount > 0
        ? `\n目前有 ${row.zoneCount} 个版块归属于它。删除只撤下目录项，这些版块会保留「${row.name}」这个值，前台仍可按它筛选，只是不再排在目录顺序里。`
        : '';
    if (!window.confirm(`删除研究所「${row.name}」及其 ${row.labs.length} 个实验室？${note}`)) return;
    run(
      row.id,
      async () => {
        await adminJson(`/api/admin/zones/org/${row.id}`, { method: 'DELETE' }, '删除失败');
        return `已删除「${row.name}」`;
      },
      '删除失败',
    );
  }

  function createLab(institute: OrgInstituteAdminRow, name: string, description: string) {
    run(
      `${institute.id}:new`,
      async () => {
        await adminJson(`/api/admin/zones/org/${institute.id}/labs`, { method: 'POST', json: { name, description } }, '新增失败');
        return `已在「${institute.name}」下新增「${name}」`;
      },
      '新增失败',
    );
  }

  function reorderLab(institute: OrgInstituteAdminRow, labId: string, dir: -1 | 1) {
    const ids = moveId(
      institute.labs.map((l) => l.id),
      labId,
      dir,
    );
    run(labId, async () => {
      await adminJson(`/api/admin/zones/org/${institute.id}/labs`, { method: 'PUT', json: { ids } }, '排序失败');
    }, '排序失败');
  }

  function patchLab(lab: OrgLabAdminRow, patch: { name?: string; description?: string }) {
    run(
      lab.id,
      async () => {
        const r = await adminJson<{ renamedZones: number }>(`/api/admin/zones/org/labs/${lab.id}`, { method: 'PATCH', json: patch }, '保存失败');
        if (patch.name !== undefined && patch.name !== lab.name) {
          return r.renamedZones > 0
            ? `已改名为「${patch.name}」，同步更新了 ${r.renamedZones} 个版块`
            : `已改名为「${patch.name}」`;
        }
        return '已保存';
      },
      '保存失败',
    );
  }

  function removeLab(institute: OrgInstituteAdminRow, lab: OrgLabAdminRow) {
    const note =
      lab.zoneCount > 0
        ? `\n目前有 ${lab.zoneCount} 个版块归属于它，这些版块会保留「${lab.name}」这个值。`
        : '';
    if (!window.confirm(`从「${institute.name}」删除实验室「${lab.name}」？${note}`)) return;
    run(
      lab.id,
      async () => {
        await adminJson(`/api/admin/zones/org/labs/${lab.id}`, { method: 'DELETE' }, '删除失败');
        return `已删除「${lab.name}」`;
      },
      '删除失败',
    );
  }

  return (
    <div className="space-y-3">
      <div className="surface flex flex-wrap items-center gap-2 rounded-xl p-2">
        <span className="px-1 text-xs text-muted">按顺序显示在前台侧栏与导航栏磁贴（最多 6 个磁贴）</span>
        <button type="button" onClick={() => setAdding((v) => !v)} className={`${ADMIN_PRIMARY_BTN} ml-auto`}>
          <Plus className="h-4 w-4" />
          新增研究所
        </button>
      </div>

      {adding && (
        <div className="surface space-y-2 rounded-xl p-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <input
              autoFocus
              value={newName}
              maxLength={NAME_MAX}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createInstitute()}
              placeholder="研究所名称，如「温哥华研究所」"
              className={`${ADMIN_INPUT_CLS} w-full`}
            />
            <input
              value={newDesc}
              maxLength={DESC_MAX}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="一句话简介（选填）"
              className={`${ADMIN_INPUT_CLS} w-full`}
            />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={pending} onClick={createInstitute} className={ADMIN_PRIMARY_BTN}>
              {busy === 'create' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              保存
            </button>
            <button type="button" onClick={() => setAdding(false)} className={ADMIN_SECONDARY_BTN}>
              取消
            </button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="surface rounded-xl p-8 text-center text-sm text-muted">
          还没有研究所。新建版块时版主填写的研究所 / 实验室会作为「已有值」出现在前台，但不会进入这个目录；
          在这里新增后才有固定顺序与简介。
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((row, idx) => (
            <li key={row.id} className="surface rounded-xl">
              <InstituteRow
                row={row}
                first={idx === 0}
                last={idx === items.length - 1}
                open={open.has(row.id)}
                busy={busy === row.id}
                pending={pending}
                onToggle={() => toggle(row.id)}
                onMove={(dir) => reorder(row.id, dir)}
                onPatch={(patch) => patchInstitute(row, patch)}
                onDelete={() => removeInstitute(row)}
              />
              {open.has(row.id) && (
                <LabsPanel
                  institute={row}
                  busyId={busy}
                  pending={pending}
                  onCreate={(name, description) => createLab(row, name, description)}
                  onMove={(labId, dir) => reorderLab(row, labId, dir)}
                  onPatch={(lab, patch) => patchLab(lab, patch)}
                  onDelete={(lab) => removeLab(row, lab)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Institute row ─────────────────────────────────────────────────────────────

function InstituteRow({
  row,
  first,
  last,
  open,
  busy,
  pending,
  onToggle,
  onMove,
  onPatch,
  onDelete,
}: {
  row: OrgInstituteAdminRow;
  first: boolean;
  last: boolean;
  open: boolean;
  busy: boolean;
  pending: boolean;
  onToggle: () => void;
  onMove: (dir: -1 | 1) => void;
  onPatch: (patch: { name?: string; description?: string; imageUrl?: string | null }) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(row.name);
  const [description, setDescription] = useState(row.description);
  const [imageUrl, setImageUrl] = useState(row.imageUrl ?? '');

  function startEdit() {
    setName(row.name);
    setDescription(row.description);
    setImageUrl(row.imageUrl ?? '');
    setEditing(true);
  }

  function save() {
    const cleanName = name.trim();
    if (!cleanName) {
      pushToast('error', '名称不能为空');
      return;
    }
    const patch: { name?: string; description?: string; imageUrl?: string | null } = {};
    if (cleanName !== row.name) patch.name = cleanName;
    if (description.trim() !== row.description) patch.description = description.trim();
    if ((imageUrl.trim() || null) !== row.imageUrl) patch.imageUrl = imageUrl.trim() || null;
    setEditing(false);
    if (Object.keys(patch).length === 0) return;
    if (patch.name !== undefined && row.zoneCount > 0) {
      if (!window.confirm(`将「${row.name}」改名为「${patch.name}」？\n归属于它的 ${row.zoneCount} 个版块会同步改为新名字。`)) return;
    }
    onPatch(patch);
  }

  return (
    <div className="flex items-start gap-2 p-3">
      <button type="button" onClick={onToggle} aria-label={open ? '收起实验室' : '展开实验室'} className={`${ADMIN_ICON_BTN} mt-0.5`}>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <input
                autoFocus
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save();
                  if (e.key === 'Escape') setEditing(false);
                }}
                placeholder="研究所名称"
                className={`${ADMIN_INPUT_CLS} w-full font-medium`}
              />
              <input
                value={description}
                maxLength={DESC_MAX}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="一句话简介（选填）"
                className={`${ADMIN_INPUT_CLS} w-full`}
              />
            </div>
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="磁贴封面地址（选填，如 /labs/vancouver.jpg 或 https://…）；留空则用版块封面或生成色块"
              className={`${ADMIN_INPUT_CLS} w-full font-mono text-xs`}
            />
            <div className="flex items-center gap-2">
              <button type="button" disabled={pending} onClick={save} className={ADMIN_PRIMARY_BTN}>
                <Check className="h-3.5 w-3.5" />
                保存
              </button>
              <button type="button" onClick={() => setEditing(false)} className={ADMIN_SECONDARY_BTN}>
                <X className="h-3.5 w-3.5" />
                取消
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm font-semibold">{row.name}</span>
            <span className="text-xs text-muted">
              {row.labs.length} 个实验室 · {row.zoneCount} 个版块
            </span>
            {row.description && <span className="w-full text-xs text-zinc-600 dark:text-zinc-400 sm:w-auto">{row.description}</span>}
            {row.imageUrl && (
              <span className="w-full truncate font-mono text-[11px] text-zinc-400" title={row.imageUrl}>
                封面 {row.imageUrl}
              </span>
            )}
          </div>
        )}
      </div>

      {!editing && (
        <div className="flex shrink-0 items-center gap-0.5">
          {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin text-zinc-400" />}
          <button type="button" disabled={pending || first} onClick={() => onMove(-1)} aria-label="上移" className={ADMIN_ICON_BTN}>
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" disabled={pending || last} onClick={() => onMove(1)} aria-label="下移" className={ADMIN_ICON_BTN}>
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button type="button" disabled={pending} onClick={startEdit} aria-label="编辑" className={ADMIN_ICON_BTN}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" disabled={pending} onClick={onDelete} aria-label="删除" className={`${ADMIN_ICON_BTN} hover:text-red-600`}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Labs panel ────────────────────────────────────────────────────────────────

function LabsPanel({
  institute,
  busyId,
  pending,
  onCreate,
  onMove,
  onPatch,
  onDelete,
}: {
  institute: OrgInstituteAdminRow;
  busyId: string | null;
  pending: boolean;
  onCreate: (name: string, description: string) => void;
  onMove: (labId: string, dir: -1 | 1) => void;
  onPatch: (lab: OrgLabAdminRow, patch: { name?: string; description?: string }) => void;
  onDelete: (lab: OrgLabAdminRow) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  function submit() {
    const clean = name.trim();
    if (!clean) {
      pushToast('error', '请输入实验室名称');
      return;
    }
    onCreate(clean, description.trim());
    setName('');
    setDescription('');
  }

  return (
    <div className="border-t border-zinc-200 px-3 py-2 pl-11 dark:border-zinc-800">
      {institute.labs.length === 0 ? (
        <p className="py-1 text-xs text-muted">还没有实验室。</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {institute.labs.map((lab, idx) => (
            <LabRow
              key={lab.id}
              lab={lab}
              first={idx === 0}
              last={idx === institute.labs.length - 1}
              busy={busyId === lab.id}
              pending={pending}
              onMove={(dir) => onMove(lab.id, dir)}
              onPatch={(patch) => onPatch(lab, patch)}
              onDelete={() => onDelete(lab)}
            />
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={name}
          maxLength={NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="新增实验室"
          className={`${ADMIN_INPUT_CLS} w-56`}
        />
        <input
          value={description}
          maxLength={DESC_MAX}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="简介（选填）"
          className={`${ADMIN_INPUT_CLS} min-w-[200px] flex-1`}
        />
        <button type="button" disabled={pending} onClick={submit} className={ADMIN_SECONDARY_BTN}>
          {busyId === `${institute.id}:new` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          添加
        </button>
      </div>
    </div>
  );
}

function LabRow({
  lab,
  first,
  last,
  busy,
  pending,
  onMove,
  onPatch,
  onDelete,
}: {
  lab: OrgLabAdminRow;
  first: boolean;
  last: boolean;
  busy: boolean;
  pending: boolean;
  onMove: (dir: -1 | 1) => void;
  onPatch: (patch: { name?: string; description?: string }) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(lab.name);
  const [description, setDescription] = useState(lab.description);

  function save() {
    const clean = name.trim();
    if (!clean) {
      pushToast('error', '名称不能为空');
      return;
    }
    const patch: { name?: string; description?: string } = {};
    if (clean !== lab.name) patch.name = clean;
    if (description.trim() !== lab.description) patch.description = description.trim();
    setEditing(false);
    if (Object.keys(patch).length === 0) return;
    if (patch.name !== undefined && lab.zoneCount > 0) {
      if (!window.confirm(`将「${lab.name}」改名为「${patch.name}」？\n归属于它的 ${lab.zoneCount} 个版块会同步改为新名字。`)) return;
    }
    onPatch(patch);
  }

  return (
    <li className="flex items-center gap-2 py-1.5">
      {editing ? (
        <>
          <input
            autoFocus
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') setEditing(false);
            }}
            className={`${ADMIN_INPUT_CLS} w-56`}
          />
          <input
            value={description}
            maxLength={DESC_MAX}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder="简介（选填）"
            className={`${ADMIN_INPUT_CLS} min-w-[200px] flex-1`}
          />
          <button type="button" onClick={save} aria-label="保存" className={ADMIN_ICON_BTN}>
            <Check className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setEditing(false)} aria-label="取消" className={ADMIN_ICON_BTN}>
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-[13px]">
            {lab.name}
            {lab.description && <span className="ml-2 text-xs text-muted">{lab.description}</span>}
          </span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">{lab.zoneCount} 版块</span>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
          <button type="button" disabled={pending || first} onClick={() => onMove(-1)} aria-label="上移" className={ADMIN_ICON_BTN}>
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" disabled={pending || last} onClick={() => onMove(1)} aria-label="下移" className={ADMIN_ICON_BTN}>
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setName(lab.name);
              setDescription(lab.description);
              setEditing(true);
            }}
            aria-label="编辑"
            className={ADMIN_ICON_BTN}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" disabled={pending} onClick={onDelete} aria-label="删除" className={`${ADMIN_ICON_BTN} hover:text-red-600`}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </li>
  );
}
