'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { Loader2, RefreshCcw, Trash2, Upload, UserPlus } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import type { EmployeeFilter } from '@/lib/employee-queries';

export interface EmployeeRow {
  id: string;
  name: string;
  accountNumber: string;
  department: string;
  lab: string;
  avatarUrl: string;
  isActive: boolean;
  updatedAt: string;
  /** 工号已匹配到注册用户 */
  hasUser: boolean;
}

interface EditState {
  name: string;
  accountNumber: string;
  department: string;
  lab: string;
  avatarUrl: string;
}

type BulkAction = 'delete' | 'activate' | 'deactivate';

const BULK_LABEL: Record<BulkAction, string> = { delete: '删除', activate: '启用', deactivate: '停用' };

function errorMessage(code: string | undefined, fallback: string): string {
  if (code === 'account_exists') return '该工号已存在（工号按数字匹配，字母前缀不区分）';
  if (code === 'invalid_input') return '输入有误，请检查后重试';
  if (code === 'not_found') return '记录不存在（可能已被删除）';
  return fallback;
}

export function EmployeeManager({
  rows,
  total,
  filter,
  filtered,
}: {
  rows: EmployeeRow[];
  /** 当前筛选下的总条数（用于「选择全部 N 条」）。 */
  total: number;
  /** 服务端当时用的筛选条件，原样回传给批量接口。 */
  filter: EmployeeFilter;
  filtered: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [panel, setPanel] = useState<'none' | 'create' | 'import'>('none');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState>({ name: '', accountNumber: '', department: '', lab: '', avatarUrl: '' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  /** true = 操作对象是"当前筛选的全部 total 条"，而不是勾选的这几行。 */
  const [allMatching, setAllMatching] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<BulkAction | null>(null);
  const bulkRef = useRef(false);
  const headRef = useRef<HTMLInputElement>(null);

  const pageIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allOnPage = rows.length > 0 && selected.size === rows.length;
  const selectedCount = allMatching ? total : selected.size;

  // 半选态只能用 DOM 属性表达（没有对应的 React prop）。
  useEffect(() => {
    if (headRef.current) headRef.current.indeterminate = selected.size > 0 && selected.size < rows.length;
  }, [selected, rows.length]);

  // router.refresh() 不会重挂组件（key 只含筛选/页码），所以刷新后行集可能变了而勾选还在。
  // 把勾选收敛回"当前屏幕上真实存在的行"，避免对已经看不到的行执行批量操作。
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const alive = new Set(pageIds);
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [pageIds]);

  function refresh() {
    startTransition(() => router.refresh());
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // 取消任意一行后，"全部 N 条"的语义就不成立了。
    setAllMatching(false);
  }

  function toggleAllOnPage(on: boolean) {
    setSelected(on ? new Set(pageIds) : new Set());
    setAllMatching(false);
  }

  function clearSelection() {
    setSelected(new Set());
    setAllMatching(false);
  }

  async function runBulk(action: BulkAction) {
    if (bulkRef.current) return; // useTransition 的 pending 跨不过 await
    const count = selectedCount;
    if (!count) return;
    const scope = allMatching
      ? filtered
        ? `当前筛选结果的全部 ${count.toLocaleString()} 条`
        : `全部 ${count.toLocaleString()} 条员工记录`
      : `选中的 ${count.toLocaleString()} 条`;
    const warn =
      action === 'delete' ? '\n\n删除不可撤销，但不会影响已同步到用户上的部门/研究所信息。' : '';
    if (!confirm(`确定${BULK_LABEL[action]}${scope}？${warn}`)) return;

    bulkRef.current = true;
    setBulkBusy(action);
    try {
      const res = await fetch('/api/admin/employees/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          allMatching ? { action, all: true, filter } : { action, ids: Array.from(selected) },
        ),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        pushToast('error', errorMessage(data?.error, `${BULK_LABEL[action]}失败`));
        return;
      }
      const synced = data.syncedUsers ? `，同步 ${data.syncedUsers} 个用户` : '';
      pushToast('success', `已${BULK_LABEL[action]} ${data.affected.toLocaleString()} 条${synced}`);
      clearSelection();
      refresh();
    } catch {
      pushToast('error', `${BULK_LABEL[action]}失败，请稍后再试`);
    } finally {
      bulkRef.current = false;
      setBulkBusy(null);
    }
  }

  async function syncAll() {
    setSyncing(true);
    try {
      const res = await fetch('/api/admin/employees/sync', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error();
      pushToast('success', `已扫描 ${data.entriesWithAccount} 条工号记录，同步更新 ${data.usersUpdated} 个用户`);
      refresh();
    } catch {
      pushToast('error', '同步失败，请稍后再试');
    } finally {
      setSyncing(false);
    }
  }

  function beginEdit(r: EmployeeRow) {
    setEditingId(r.id);
    setEdit({ name: r.name, accountNumber: r.accountNumber, department: r.department, lab: r.lab, avatarUrl: r.avatarUrl });
  }

  async function saveEdit(id: string) {
    if (!edit.name.trim()) {
      pushToast('error', '姓名必填');
      return;
    }
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/employees/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(edit),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        pushToast('error', errorMessage(data?.error, '保存失败'));
        return;
      }
      pushToast('success', data.syncedUsers ? `已保存，已同步 ${data.syncedUsers} 个用户` : '已保存');
      setEditingId(null);
      refresh();
    } catch {
      pushToast('error', '保存失败，请稍后再试');
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(r: EmployeeRow) {
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/admin/employees/${r.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isActive: !r.isActive }),
      });
      if (!res.ok) throw new Error();
      pushToast('success', r.isActive ? '已停用' : '已启用');
      refresh();
    } catch {
      pushToast('error', '操作失败');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(r: EmployeeRow) {
    if (!confirm(`确定删除「${r.name}」？删除不会影响已同步到用户上的部门/研究所信息。`)) return;
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/admin/employees/${r.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error();
      pushToast('success', '已删除');
      refresh();
    } catch {
      pushToast('error', '删除失败');
    } finally {
      setBusyId(null);
    }
  }

  const bulkBtn =
    'flex h-7 items-center gap-1 rounded-lg border border-zinc-200 px-2.5 text-xs transition hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 disabled:opacity-60 dark:border-zinc-700';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          onClick={syncAll}
          disabled={syncing}
          title="按工号把部门/研究所写入所有匹配的注册用户"
          className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 disabled:opacity-60 dark:border-zinc-700"
        >
          {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
          {syncing ? '同步中…' : '同步到用户'}
        </button>
        <button
          onClick={() => setPanel(panel === 'import' ? 'none' : 'import')}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700"
        >
          <Upload className="h-3.5 w-3.5" />
          批量导入
        </button>
        <button
          onClick={() => setPanel(panel === 'create' ? 'none' : 'create')}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300"
        >
          <UserPlus className="h-3.5 w-3.5" />
          新增员工
        </button>
      </div>

      {panel === 'create' && <CreatePanel onDone={() => { setPanel('none'); refresh(); }} onCancel={() => setPanel('none')} />}
      {panel === 'import' && (
        <ImportPanel onDone={() => { setPanel('none'); refresh(); }} onCancel={() => setPanel('none')} onPartial={refresh} />
      )}

      {selected.size > 0 && (
        // top-14 / z-10 是必须的：/manage 的顶栏是 fixed top-0 z-20 h-14（layout.tsx），
        // sticky top-0 会跟它重叠，z-20 还会因为 DOM 顺序盖在顶栏上面。
        // 背景不透明：表头自己也是 sticky 的，半透明会糊成一片。
        <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-900/40 dark:border-zinc-100/40 bg-white p-2 text-sm shadow-sm dark:bg-zinc-950">
          <span className="px-1 font-medium">
            已选 {selectedCount.toLocaleString()} 条
            {allMatching && <span className="ml-1 text-xs font-normal text-muted">（{filtered ? '当前筛选全部' : '全表'}）</span>}
          </span>
          {allOnPage && total > rows.length && !allMatching && (
            <button onClick={() => setAllMatching(true)} className="text-xs text-zinc-900 dark:text-zinc-50 underline-offset-2 hover:underline">
              选择全部 {total.toLocaleString()} 条{filtered ? '（当前筛选）' : ''}
            </button>
          )}
          {allMatching && (
            <button onClick={() => setAllMatching(false)} className="text-xs text-zinc-900 dark:text-zinc-50 underline-offset-2 hover:underline">
              仅选本页 {rows.length} 条
            </button>
          )}
          <span className="flex-1" />
          <button onClick={() => runBulk('activate')} disabled={bulkBusy !== null} className={bulkBtn}>
            {bulkBusy === 'activate' && <Loader2 className="h-3 w-3 animate-spin" />}
            批量启用
          </button>
          <button onClick={() => runBulk('deactivate')} disabled={bulkBusy !== null} className={bulkBtn}>
            {bulkBusy === 'deactivate' && <Loader2 className="h-3 w-3 animate-spin" />}
            批量停用
          </button>
          <button
            onClick={() => runBulk('delete')}
            disabled={bulkBusy !== null}
            className="flex h-7 items-center gap-1 rounded-lg border border-danger/40 px-2.5 text-xs text-danger transition hover:bg-danger/10 disabled:opacity-60"
          >
            {bulkBusy === 'delete' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            批量删除
          </button>
          <button onClick={clearSelection} className="h-7 rounded-lg px-2 text-xs text-muted hover:text-zinc-800 dark:hover:text-zinc-200">
            取消选择
          </button>
        </div>
      )}

      <div className="surface overflow-x-auto rounded-xl">
        <table className="data">
          <thead>
            <tr>
              <th className="w-8">
                <input
                  ref={headRef}
                  type="checkbox"
                  checked={allOnPage}
                  onChange={(e) => toggleAllOnPage(e.target.checked)}
                  aria-label="全选本页"
                  className="h-3.5 w-3.5 accent-zinc-900 dark:accent-zinc-100"
                />
              </th>
              <th>
                姓名 <span className="text-danger">*</span>
              </th>
              <th>工号</th>
              <th>部门</th>
              <th>研究所</th>
              <th>关联用户</th>
              <th>启用</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const editing = editingId === r.id;
              const busy = busyId === r.id;
              const checked = allMatching || selected.has(r.id);
              return (
                <tr key={r.id} className={r.isActive ? undefined : 'opacity-50'}>
                  <td>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleRow(r.id)}
                      aria-label={`选择 ${r.name}`}
                      className="h-3.5 w-3.5 accent-zinc-900 dark:accent-zinc-100"
                    />
                  </td>
                  {editing ? (
                    <>
                      <td>
                        <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="h-7 w-28 rounded border border-zinc-200 bg-white px-2 text-[12px] dark:border-zinc-700 dark:bg-zinc-900" />
                      </td>
                      <td>
                        <input value={edit.accountNumber} onChange={(e) => setEdit({ ...edit, accountNumber: e.target.value })} className="h-7 w-28 rounded border border-zinc-200 bg-white px-2 font-mono text-[12px] dark:border-zinc-700 dark:bg-zinc-900" />
                      </td>
                      <td>
                        <input value={edit.department} onChange={(e) => setEdit({ ...edit, department: e.target.value })} className="h-7 w-32 rounded border border-zinc-200 bg-white px-2 text-[12px] dark:border-zinc-700 dark:bg-zinc-900" />
                      </td>
                      <td>
                        <input value={edit.lab} onChange={(e) => setEdit({ ...edit, lab: e.target.value })} className="h-7 w-32 rounded border border-zinc-200 bg-white px-2 text-[12px] dark:border-zinc-700 dark:bg-zinc-900" />
                      </td>
                    </>
                  ) : (
                    <>
                      <td>
                        <span className="font-medium">{r.name}</span>
                      </td>
                      <td className="font-mono text-[12px]">{r.accountNumber || <span className="font-sans text-muted">—</span>}</td>
                      <td className="text-[12px]">{r.department || <span className="text-muted">—</span>}</td>
                      <td className="text-[12px]">{r.lab || <span className="text-muted">—</span>}</td>
                    </>
                  )}
                  <td>
                    {r.hasUser ? (
                      <span className="badge" style={{ background: '#dcfce7', color: '#166534' }}>
                        已注册
                      </span>
                    ) : (
                      <span className="badge" style={{ background: '#f4f4f5', color: '#71717a' }}>
                        未注册
                      </span>
                    )}
                  </td>
                  <td>
                    <button
                      role="switch"
                      aria-checked={r.isActive}
                      disabled={busy}
                      onClick={() => toggleActive(r)}
                      className={`relative h-5 w-9 rounded-full transition ${r.isActive ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-300 dark:bg-zinc-700'}`}
                    >
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${r.isActive ? 'left-[18px]' : 'left-0.5'}`} />
                    </button>
                  </td>
                  <td className="font-mono text-[11px] tabular-nums">{format(new Date(r.updatedAt), 'yyyy-MM-dd HH:mm')}</td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      {editing ? (
                        <>
                          <button
                            onClick={() => saveEdit(r.id)}
                            disabled={busy}
                            className="flex h-6 items-center rounded border border-zinc-200 px-2 text-[11px] hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 disabled:opacity-60 dark:border-zinc-700"
                          >
                            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : '保存'}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="flex h-6 items-center rounded border border-zinc-200 px-2 text-[11px] text-muted hover:text-zinc-800 dark:border-zinc-700 dark:hover:text-zinc-200"
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => beginEdit(r)}
                            className="flex h-6 items-center rounded border border-zinc-200 px-2 text-[11px] hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => remove(r)}
                            disabled={busy}
                            className="flex h-6 items-center rounded border border-danger/40 px-2 text-[11px] text-danger hover:bg-danger/10 disabled:opacity-60"
                          >
                            删除
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={9} className="py-10 text-center text-muted">
                  没有匹配的员工 — 换个筛选，或点右上角「批量导入」
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {isPending && (
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <Loader2 className="h-3 w-3 animate-spin" /> 刷新中…
        </div>
      )}
    </div>
  );
}

function CreatePanel({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ name: '', accountNumber: '', department: '', lab: '', avatarUrl: '' });
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!form.name.trim()) {
      pushToast('error', '姓名必填');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/employees', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        pushToast('error', errorMessage(data?.error, '创建失败'));
        return;
      }
      pushToast('success', data.syncedUsers ? `已创建，已同步 ${data.syncedUsers} 个用户` : '已创建');
      onDone();
    } catch {
      pushToast('error', '创建失败，请稍后再试');
    } finally {
      setSaving(false);
    }
  }

  const input = 'h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900';
  const label = 'mb-1.5 block text-xs font-medium text-muted';
  return (
    <div className="surface space-y-3 rounded-xl p-4">
      <h3 className="text-sm font-semibold">新增员工</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>
            姓名 <span className="text-danger">*</span>
          </label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
        </div>
        <div>
          <label className={label}>工号</label>
          <input
            value={form.accountNumber}
            onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
            placeholder="如：z0012345（用于自动同步到用户）"
            className={input}
          />
        </div>
        <div>
          <label className={label}>部门</label>
          <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="如：AI事业部" className={input} />
        </div>
        <div>
          <label className={label}>研究所</label>
          <input value={form.lab} onChange={(e) => setForm({ ...form, lab: e.target.value })} placeholder="如：计算视觉研究所" className={input} />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>头像 URL（可选）</label>
          <input value={form.avatarUrl} onChange={(e) => setForm({ ...form, avatarUrl: e.target.value })} className={input} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="h-9 rounded-lg border border-zinc-200 px-4 text-sm text-muted hover:text-zinc-800 dark:border-zinc-800 dark:hover:text-zinc-200">
          取消
        </button>
        <button
          onClick={submit}
          disabled={saving}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-60"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          添加
        </button>
      </div>
    </div>
  );
}

interface ImportSummary {
  parsedRows: number;
  added: number;
  updated: number;
  unchanged: number;
  backfilledAccounts: number;
  mergedDuplicates: number;
  mergedRows?: string[];
  skipped: number;
  syncedUsers: number;
  warnings?: string[];
  errors?: string[];
  warningCount?: number;
  errorCount?: number;
}

function summarize(d: ImportSummary): string {
  const parts = [`解析 ${d.parsedRows} 行`, `新增 ${d.added}`, `更新 ${d.updated}`];
  if (d.backfilledAccounts) parts.push(`回填工号 ${d.backfilledAccounts}`);
  if (d.mergedDuplicates) parts.push(`合并删除 ${d.mergedDuplicates}`);
  if (d.unchanged) parts.push(`无变化 ${d.unchanged}`);
  if (d.skipped) parts.push(`跳过 ${d.skipped}`);
  parts.push(`同步 ${d.syncedUsers} 个用户`);
  return parts.join('，');
}

function ImportPanel({
  onDone,
  onCancel,
  onPartial,
}: {
  onDone: () => void;
  onCancel: () => void;
  /** 部分行失败/存疑时：面板保持打开展示明细，但表格仍需刷新已导入的行。 */
  onPartial: () => void;
}) {
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [clearMissing, setClearMissing] = useState(false);
  const [mergeNameDuplicates, setMergeNameDuplicates] = useState(false);
  const [rowErrors, setRowErrors] = useState<string[]>([]);
  const [rowWarnings, setRowWarnings] = useState<string[]>([]);
  const [merged, setMerged] = useState<string[]>([]);
  const [counts, setCounts] = useState<{ warningCount: number; errorCount: number }>({ warningCount: 0, errorCount: 0 });

  async function submit() {
    const file = fileRef.current?.files?.[0] ?? null;
    if (!file && !text.trim()) {
      pushToast('error', '请粘贴文本或选择文件');
      return;
    }
    if (file && text.trim()) {
      pushToast('error', '请只用一种方式：粘贴文本或上传文件（另一个留空）');
      return;
    }
    if (
      mergeNameDuplicates &&
      !confirm('「合并同名旧记录」会删除同名、无工号、且部门不矛盾的历史行，不可撤销（删掉的会逐条列出）。确定继续？')
    ) {
      return;
    }
    setImporting(true);
    setRowErrors([]);
    setRowWarnings([]);
    setMerged([]);
    try {
      const fd = new FormData();
      if (file) fd.set('file', file);
      else fd.set('text', text);
      fd.set('clearMissing', String(clearMissing));
      fd.set('mergeNameDuplicates', String(mergeNameDuplicates));
      const res = await fetch('/api/admin/employees/import', { method: 'POST', body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        pushToast('error', data?.message || errorMessage(data?.error, '导入失败'));
        return;
      }
      const errorCount = data.errorCount ?? data.errors?.length ?? 0;
      const warningCount = data.warningCount ?? data.warnings?.length ?? 0;
      pushToast('success', `${summarize(data)}${errorCount ? `，${errorCount} 条错误` : ''}`);
      if (errorCount || warningCount || data.mergedRows?.length) {
        // 有失败/存疑行、或删过行时保留面板并列出明细，否则无从追查。
        setRowErrors(data.errors ?? []);
        setRowWarnings(data.warnings ?? []);
        setMerged(data.mergedRows ?? []);
        setCounts({ warningCount, errorCount });
        onPartial();
      } else {
        onDone();
      }
    } catch {
      pushToast('error', '导入失败，请稍后再试');
    } finally {
      setImporting(false);
    }
  }

  const optionBox = 'flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-200 p-2.5 text-xs dark:border-zinc-800';

  return (
    <div className="surface space-y-3 rounded-xl p-4">
      <h3 className="text-sm font-semibold">批量导入员工</h3>
      <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
        <li>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">只有姓名是必填项。</span>
        </li>
        <li>
          粘贴文本时每行一人，按 <code className="font-mono">姓名,工号,部门,研究所,头像URL</code> 顺序填，留空即可跳过（从 Excel
          直接复制粘贴也可以）。
        </li>
        <li>上传文件时 CSV/XLSX 首行为表头，可识别 姓名/工号/部门/研究所 等中文列名，列顺序任意。</li>
        <li>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">重复上传会覆盖，不会再产生重复行：</span>
          先按工号匹配（只比较数字，<code className="font-mono">z84412632</code> 与{' '}
          <code className="font-mono">84412632</code> 视为同一人，但按你导入的写法保存）；工号是新的就按姓名找到那条
          <span className="font-medium text-zinc-700 dark:text-zinc-300">早期没填工号的旧记录</span>并把工号补上去。
        </li>
        <li>同名有多条又无法用部门/研究所区分时，不会瞎猜：带工号的另建一条并提示你人工合并，不带工号的直接跳过。</li>
        <li>已停用的记录会被更新，但不会因为导入而重新启用（需要的话勾选后用「批量启用」）。</li>
        <li>导入后会自动按工号把部门/研究所同步到已注册用户；之后新注册/登录的用户也会自动带上。</li>
      </ul>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className={optionBox}>
          <input
            type="checkbox"
            checked={clearMissing}
            onChange={(e) => setClearMissing(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-zinc-900 dark:accent-zinc-100"
          />
          <span>
            <span className="font-medium">空值也覆盖</span>
            <span className="mt-0.5 block text-muted">
              导入行留空的部门/研究所/头像会被清空。不勾选时只有填了值才覆盖（工号任何情况下都不会被清空）。
            </span>
          </span>
        </label>
        <label className={optionBox}>
          <input
            type="checkbox"
            checked={mergeNameDuplicates}
            onChange={(e) => setMergeNameDuplicates(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-zinc-900 dark:accent-zinc-100"
          />
          <span>
            <span className="font-medium text-danger">合并同名旧记录（会删行）</span>
            <span className="mt-0.5 block text-muted">
              匹配到的记录带工号后，删掉同名、没有工号、且部门/研究所不矛盾的历史行；部门对不上的（可能是同名的另一个人）
              只提示不删。删掉的会逐条列出来。
            </span>
          </span>
        </label>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted">粘贴文本</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={'张三\n李四,1002\n王五,1003,AI事业部,计算视觉所'}
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-[12px] dark:border-zinc-800 dark:bg-zinc-900"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted">或上传文件（.csv / .xlsx）</label>
        <input ref={fileRef} type="file" accept=".csv,.xlsx" className="block text-xs" />
      </div>
      {merged.length > 0 && (
        // 硬删除必须逐条摆在管理员眼前 —— 只报一个数字，删错了既发现不了也恢复不了。
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-1.5 text-xs font-medium">已合并删除以下 {merged.length} 条同名旧记录：</p>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto text-[11px] text-muted">
            {merged.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {rowWarnings.length > 0 && (
        <div className="rounded-lg border border-warn/30 bg-warn/5 p-3">
          <p className="mb-1.5 text-xs font-medium text-warn">
            以下 {counts.warningCount || rowWarnings.length} 行需要人工确认
            {counts.warningCount > rowWarnings.length && `（仅列出前 ${rowWarnings.length} 条）`}：
          </p>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto text-[11px] text-warn/90">
            {rowWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {rowErrors.length > 0 && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-3">
          <p className="mb-1.5 text-xs font-medium text-danger">
            以下 {counts.errorCount || rowErrors.length} 行未导入
            {counts.errorCount > rowErrors.length && `（仅列出前 ${rowErrors.length} 条）`}：
          </p>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto font-mono text-[11px] text-danger/90">
            {rowErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="h-9 rounded-lg border border-zinc-200 px-4 text-sm text-muted hover:text-zinc-800 dark:border-zinc-800 dark:hover:text-zinc-200">
          取消
        </button>
        <button
          onClick={submit}
          disabled={importing}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-60"
        >
          {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          开始导入
        </button>
      </div>
    </div>
  );
}
