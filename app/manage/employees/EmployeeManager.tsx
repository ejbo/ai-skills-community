'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { Loader2, RefreshCcw, Upload, UserPlus } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

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

function errorMessage(code: string | undefined, fallback: string): string {
  if (code === 'account_exists') return '该工号已存在（工号按数字匹配，字母前缀不区分）';
  if (code === 'invalid_input') return '输入有误，请检查后重试';
  if (code === 'not_found') return '记录不存在（可能已被删除）';
  return fallback;
}

export function EmployeeManager({ rows }: { rows: EmployeeRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [panel, setPanel] = useState<'none' | 'create' | 'import'>('none');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState>({ name: '', accountNumber: '', department: '', lab: '', avatarUrl: '' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  function refresh() {
    startTransition(() => router.refresh());
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          onClick={syncAll}
          disabled={syncing}
          title="按工号把部门/研究所写入所有匹配的注册用户"
          className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm hover:border-accent-500 hover:text-accent-600 disabled:opacity-60 dark:border-zinc-700"
        >
          {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
          {syncing ? '同步中…' : '同步到用户'}
        </button>
        <button
          onClick={() => setPanel(panel === 'import' ? 'none' : 'import')}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm hover:border-accent-500 hover:text-accent-600 dark:border-zinc-700"
        >
          <Upload className="h-3.5 w-3.5" />
          批量导入
        </button>
        <button
          onClick={() => setPanel(panel === 'create' ? 'none' : 'create')}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white hover:bg-accent-600"
        >
          <UserPlus className="h-3.5 w-3.5" />
          新增员工
        </button>
      </div>

      {panel === 'create' && <CreatePanel onDone={() => { setPanel('none'); refresh(); }} onCancel={() => setPanel('none')} />}
      {panel === 'import' && (
        <ImportPanel onDone={() => { setPanel('none'); refresh(); }} onCancel={() => setPanel('none')} onPartial={refresh} />
      )}

      <div className="surface overflow-x-auto rounded-xl">
        <table className="data">
          <thead>
            <tr>
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
              return (
                <tr key={r.id} className={r.isActive ? undefined : 'opacity-50'}>
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
                      className={`relative h-5 w-9 rounded-full transition ${r.isActive ? 'bg-accent-500' : 'bg-zinc-300 dark:bg-zinc-700'}`}
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
                            className="flex h-6 items-center rounded border border-zinc-200 px-2 text-[11px] hover:border-accent-500 hover:text-accent-600 disabled:opacity-60 dark:border-zinc-700"
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
                            className="flex h-6 items-center rounded border border-zinc-200 px-2 text-[11px] hover:border-accent-500 hover:text-accent-600 dark:border-zinc-700"
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
                <td colSpan={8} className="py-10 text-center text-muted">
                  还没有员工 — 点右上角「批量导入」开始
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
          className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-60"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          添加
        </button>
      </div>
    </div>
  );
}

function ImportPanel({
  onDone,
  onCancel,
  onPartial,
}: {
  onDone: () => void;
  onCancel: () => void;
  /** 部分行失败时：面板保持打开展示错误，但表格仍需刷新已导入的行。 */
  onPartial: () => void;
}) {
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [rowErrors, setRowErrors] = useState<string[]>([]);

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
    setImporting(true);
    setRowErrors([]);
    try {
      const fd = new FormData();
      if (file) fd.set('file', file);
      else fd.set('text', text);
      const res = await fetch('/api/admin/employees/import', { method: 'POST', body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        pushToast('error', data?.message || errorMessage(data?.error, '导入失败'));
        return;
      }
      const errSuffix = data.errors?.length ? `，${data.errors.length} 条错误` : '';
      pushToast(
        'success',
        `解析 ${data.parsedRows} 行，新增 ${data.added}，跳过/更新 ${data.skippedOrUpdated}，同步 ${data.syncedUsers} 个用户${errSuffix}`,
      );
      if (data.errors?.length) {
        // 有失败行时保留面板并列出明细，否则失败行无从追查。
        setRowErrors(data.errors);
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
          工号填了的话同一工号会被去重并更新；未填工号则按「姓名+部门+研究所」组合判重。工号只比较数字部分（
          <code className="font-mono">z84412632</code> 与 <code className="font-mono">84412632</code>{' '}
          视为同一人，登录账号里的工号通常只有数字），但原样保存你导入的写法。
        </li>
        <li>导入后会自动按工号把部门/研究所同步到已注册用户；之后新注册/登录的用户也会自动带上。</li>
      </ul>
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
      {rowErrors.length > 0 && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-3">
          <p className="mb-1.5 text-xs font-medium text-danger">以下 {rowErrors.length} 行未导入：</p>
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
          className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-60"
        >
          {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          开始导入
        </button>
      </div>
    </div>
  );
}
