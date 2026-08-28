// 技术专区 — shared monochrome class strings + tiny client helpers for the U1
// surfaces (hub / zone home / members / settings / create). Import-free of
// prisma/env so every client component can use it. Contract rule 7: zinc only,
// hairline borders, mono figures, no accent chips — the colour is the data.

export const BTN_PRIMARY =
  'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white';

export const BTN_SECONDARY =
  'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-100';

export const BTN_GHOST =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100';

export const BTN_DANGER =
  'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-danger/40 px-4 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50';

export const INPUT_CLS =
  'h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-400';

export const TEXTAREA_CLS =
  'w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-400';

export const SELECT_CLS =
  'h-9 rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-400';

export const LABEL_CLS = 'mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400';
export const HINT_CLS = 'mt-1 text-xs text-muted';

/** Outlined mono pill — post types, visibility, join policy, role keys. */
export const PILL_MONO =
  'inline-flex shrink-0 items-center gap-1 rounded-full border border-zinc-300 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-zinc-600 dark:border-zinc-700 dark:text-zinc-400';

/** Filled (ink) mono pill — the single emphasised state (e.g. 主版主, 置顶). */
export const PILL_INK =
  'inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-900 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-white dark:bg-zinc-50 dark:text-zinc-900';

/** Filter chip (URL-driven lists). */
export function chipCls(active: boolean): string {
  return `shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition ${
    active
      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900'
      : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
  }`;
}

export const CARD_CLS =
  'rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950';

export const SECTION_TITLE_CLS =
  'text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500';

/** Parse a JSON error body without throwing; `reason` is the localized server hint. */
export async function readError(res: Response): Promise<{ error: string; reason?: string }> {
  const data = (await res.json().catch(() => ({}))) as { error?: unknown; reason?: unknown };
  return {
    error: typeof data.error === 'string' ? data.error : 'failed',
    reason: typeof data.reason === 'string' ? data.reason : undefined,
  };
}

/**
 * Re-export so zone code can keep importing it from the section's ui module.
 * The implementation is the app-wide one (lib/auth/callback-path.ts) — it also
 * strips the deploy basePath and refuses anything that is not an in-app path.
 */
export { loginHref } from '@/lib/auth/callback-path';

/** Build `/zones/<slug>?…` (or any base) dropping empty values and `page=1`. */
export function hrefWith(base: string, params: Record<string, string | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (!v) continue;
    if (k === 'page' && v === '1') continue;
    sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}
