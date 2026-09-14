'use client';

// 栏目预设编辑器（/manage 全站中文）：新增 / 行内改名与简介 / ↑↓ 排序 / 删除，以及
// 「同步到所有版块」（只补缺，不改名、不删除，结果计数进 toast）。
//
//   GET/POST/PUT  /api/admin/zones/column-presets       { name, description? } | { ids }
//   PATCH/DELETE  /api/admin/zones/column-presets/[id]  { name?, description? }
//   POST          /api/admin/zones/column-presets/apply

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Check, Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import type { ZoneColumnPresetView } from '@/lib/zones/column-presets';
import { ZONE_LIMITS } from '@/lib/zones/shared';
import { ADMIN_ICON_BTN, ADMIN_INPUT_CLS, ADMIN_PRIMARY_BTN, ADMIN_SECONDARY_BTN, adminJson, moveId } from '../_components/admin-fetch';

interface ApplyResult {
  zonesScanned: number;
  zonesTouched: number;
  columnsCreated: number;
  zonesSkippedFull: number;
}

export function ColumnPresetsManager({ items, zoneCount }: { items: ZoneColumnPresetView[]; zoneCount: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [lastApply, setLastApply] = useState<ApplyResult | null>(null);

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

  function create() {
    const name = newName.trim();
    if (!name) {
      pushToast('error', '请输入栏目名称');
      return;
    }
    run(
      'create',
      async () => {
        await adminJson('/api/admin/zones/column-presets', { method: 'POST', json: { name, description: newDesc.trim() } }, '新增失败');
        setNewName('');
        setNewDesc('');
        return `已新增预设「${name}」`;
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
      await adminJson('/api/admin/zones/column-presets', { method: 'PUT', json: { ids } }, '排序失败');
    }, '排序失败');
  }

  function patch(row: ZoneColumnPresetView, body: { name?: string; description?: string }) {
    run(
      row.id,
      async () => {
        await adminJson(`/api/admin/zones/column-presets/${row.id}`, { method: 'PATCH', json: body }, '保存失败');
        return '已保存';
      },
      '保存失败',
    );
  }

  function remove(row: ZoneColumnPresetView) {
    if (!window.confirm(`删除预设「${row.name}」？\n只是从预设清单撤下；已经有这个栏目的版块不受影响，新建的版块不再自动带它。`)) return;
    run(
      row.id,
      async () => {
        await adminJson(`/api/admin/zones/column-presets/${row.id}`, { method: 'DELETE' }, '删除失败');
        return `已删除预设「${row.name}」`;
      },
      '删除失败',
    );
  }

  function applyAll() {
    if (items.length === 0) {
      pushToast('error', '还没有预设，无需同步');
      return;
    }
    if (
      !window.confirm(
        `把 ${items.length} 个预设同步到全部 ${zoneCount} 个在线版块？\n\n只会给缺少这些栏目的版块「新增」官方栏目（同名的按大小写 / 空格不敏感去重）；不会改名、不会删除、不会调整版主已有的栏目。栏目已满（60 个）的版块会跳过。`,
      )
    )
      return;
    run(
      'apply',
      async () => {
        const r = await adminJson<ApplyResult>('/api/admin/zones/column-presets/apply', { method: 'POST' }, '同步失败');
        setLastApply(r);
        return `已扫描 ${r.zonesScanned} 个版块：${r.zonesTouched} 个新增了栏目，共新增 ${r.columnsCreated} 个${
          r.zonesSkippedFull > 0 ? `，${r.zonesSkippedFull} 个因栏目已满跳过` : ''
        }`;
      },
      '同步失败',
    );
  }

  return (
    <div className="space-y-3">
      <div className="surface flex flex-wrap items-center gap-2 rounded-xl p-2">
        <input
          value={newName}
          maxLength={ZONE_LIMITS.columnNameMax}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
          placeholder="新增栏目名称，如「每周论文导读」"
          className={`${ADMIN_INPUT_CLS} w-56`}
        />
        <input
          value={newDesc}
          maxLength={ZONE_LIMITS.columnDescriptionMax}
          onChange={(e) => setNewDesc(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
          placeholder="简介（选填，展示在栏目横幅里）"
          className={`${ADMIN_INPUT_CLS} min-w-[220px] flex-1`}
        />
        <button type="button" disabled={pending} onClick={create} className={ADMIN_PRIMARY_BTN}>
          {busy === 'create' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          新增预设
        </button>
        <button type="button" disabled={pending || items.length === 0} onClick={applyAll} className={`${ADMIN_SECONDARY_BTN} ml-auto`}>
          {busy === 'apply' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          同步到所有版块
        </button>
      </div>

      {lastApply && (
        <p className="px-1 text-xs text-muted">
          上次同步：扫描 {lastApply.zonesScanned} 个版块，{lastApply.zonesTouched} 个新增了栏目（共 {lastApply.columnsCreated} 个）
          {lastApply.zonesSkippedFull > 0 ? `，${lastApply.zonesSkippedFull} 个因栏目已满跳过` : ''}。
        </p>
      )}

      {items.length === 0 ? (
        <div className="surface rounded-xl p-8 text-center text-sm text-muted">
          还没有预设。新建的版块目前不带任何栏目，由版主自己在「版块设置 → 栏目」里创建。
        </div>
      ) : (
        <ul className="surface divide-y divide-zinc-100 rounded-xl dark:divide-zinc-800/60">
          {items.map((row, idx) => (
            <PresetRow
              key={row.id}
              row={row}
              index={idx}
              first={idx === 0}
              last={idx === items.length - 1}
              busy={busy === row.id}
              pending={pending}
              onMove={(dir) => reorder(row.id, dir)}
              onPatch={(body) => patch(row, body)}
              onDelete={() => remove(row)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PresetRow({
  row,
  index,
  first,
  last,
  busy,
  pending,
  onMove,
  onPatch,
  onDelete,
}: {
  row: ZoneColumnPresetView;
  index: number;
  first: boolean;
  last: boolean;
  busy: boolean;
  pending: boolean;
  onMove: (dir: -1 | 1) => void;
  onPatch: (body: { name?: string; description?: string }) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(row.name);
  const [description, setDescription] = useState(row.description);

  function save() {
    const clean = name.trim();
    if (!clean) {
      pushToast('error', '名称不能为空');
      return;
    }
    const body: { name?: string; description?: string } = {};
    if (clean !== row.name) body.name = clean;
    if (description.trim() !== row.description) body.description = description.trim();
    setEditing(false);
    if (Object.keys(body).length > 0) onPatch(body);
  }

  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <span className="w-6 shrink-0 font-mono text-[11px] tabular-nums text-muted">{index + 1}</span>
      {editing ? (
        <>
          <input
            autoFocus
            value={name}
            maxLength={ZONE_LIMITS.columnNameMax}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') setEditing(false);
            }}
            className={`${ADMIN_INPUT_CLS} w-56 font-medium`}
          />
          <input
            value={description}
            maxLength={ZONE_LIMITS.columnDescriptionMax}
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
            <span className="font-medium">{row.name}</span>
            {row.description && <span className="ml-2 text-xs text-muted">{row.description}</span>}
          </span>
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
              setName(row.name);
              setDescription(row.description);
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
