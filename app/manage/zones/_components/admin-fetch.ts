// 技术专区后台三个子页共用的请求小工具（客户端）：JSON 请求 + 错误码 → 中文。
// 与 ZonesManager.tsx 的 ERROR_MESSAGES / errorMessage 同一口径。

export const ADMIN_ERROR_MESSAGES: Record<string, string> = {
  invalid_input: '输入不合法，请检查各字段',
  name_taken: '这个名字已经存在',
  not_found: '记录不存在，可能已被删除',
  org_full: '数量已达上限',
  presets_full: '预设数量已达上限',
  forbidden: '没有权限执行此操作',
  unauthenticated: '登录已失效，请重新登录',
  conflict: '操作冲突，请重试',
  rate_limited: '操作太频繁，请稍后再试',
};

export function adminErrorMessage(data: unknown, fallback: string): string {
  const d = (data && typeof data === 'object' ? data : {}) as { error?: unknown; reason?: unknown };
  const code = typeof d.error === 'string' ? d.error : '';
  if (code && ADMIN_ERROR_MESSAGES[code]) return ADMIN_ERROR_MESSAGES[code];
  if (typeof d.reason === 'string' && d.reason.trim()) return d.reason;
  return code ? `${fallback}（${code}）` : fallback;
}

export class AdminRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'AdminRequestError';
  }
}

/** JSON in, JSON out; throws AdminRequestError with the localized message on non-2xx. */
export async function adminJson<T = unknown>(url: string, init: RequestInit & { json?: unknown } = {}, failMsg = '操作失败'): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new AdminRequestError(adminErrorMessage(data, failMsg), res.status);
  return data as T;
}

export const ADMIN_INPUT_CLS =
  'h-8 rounded-lg border border-zinc-200 bg-white px-2.5 text-[13px] outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-600';

export const ADMIN_ICON_BTN =
  'flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-100';

export const ADMIN_PRIMARY_BTN =
  'flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-[13px] font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white';

export const ADMIN_SECONDARY_BTN =
  'flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-[13px] font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800';

/** Swap two neighbours in an id list — the ↑ / ↓ buttons. */
export function moveId(ids: readonly string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return [...ids];
  const out = [...ids];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
