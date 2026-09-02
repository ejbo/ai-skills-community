'use client';

// 技术专区 — 版块设置 → 栏目. The zone's own taxonomy, curated by anyone holding
// `moderate` (the column routes gate on that key, not `manage`): 允许成员自建栏目,
// the hand-ordered 官方栏目 list (drag + ↑/↓ twins, inline rename/describe,
// 取消官方, delete-with-move), a 新建官方栏目 form, the 成员创建 list (设为官方,
// rename, delete) and the 未归栏 line.
//
// Contract with the five existing routes (nothing here invents a request shape):
//   GET    /api/zones/<slug>/columns              → { items, allowMemberColumns }
//   POST   /api/zones/<slug>/columns              { name, description, official: true } → { column, created }
//   PATCH  /api/zones/<slug>/columns              { orderedIds } → { ok, items }
//   PATCH  /api/zones/<slug>/columns/<id>         { name?, description?, official? } → { column }
//   DELETE /api/zones/<slug>/columns/<id>         { moveToColumnId } → { ok }
//   PATCH  /api/zones/<slug>                      { allowMemberColumns }   ← zone `manage`, NOT `moderate`
//
// The one route that is not `moderate`-gated is the switch's: `allowMemberColumns`
// lives on the zone row, so a 版主 without `manage` gets a 403 from it. The
// editor therefore takes `canManage` and renders the switch inert with a hint
// for them, instead of letting it flip and roll back.
//
// The list is seeded from the RSC props but owned HERE: every mutation applies
// its own response locally (instant feedback) and then re-reads GET …/columns —
// `postCount` is recomputed server-side inside the same transaction as the move
// (lib/zones/columns.ts), so the re-read is the only trustworthy count. A 404
// on a row mutation means another moderator removed it meanwhile: re-read so
// the stale row / move-target option leaves, and say which one vanished.
//
// `router.refresh()` is deliberately NOT called per mutation. On this app a
// refresh replaces the page subtree ~50 ms after the RSC payload lands, which
// remounted this editor mid-edit: focus fell to <body> after every ↑/↓, a press
// issued between a response and its refresh was discarded (the remount re-seeded
// from the older props), and an open rename / confirm panel on another row was
// destroyed. The RSC only has to change once the editor is gone (the `?tab=`
// remount seeds from `zone.columns`; the zone home rail reads the same), so ONE
// refresh fires on UNMOUNT when anything was persisted.
//
// Keyboard reorder is COALESCED: ↑/↓ presses edit the local order at once and a
// single `{ orderedIds }` PATCH goes out ORDER_COMMIT_DELAY_MS after the last
// press (a drop commits immediately). The column routes share a 30/min write
// limiter per user, and one PATCH per press burnt it in a single trip across a
// long list. Presses landing while a PATCH is in flight mark the session dirty:
// that response is NOT applied (it would clobber the order on screen) and
// another commit is scheduled, so the server always ends on what the user sees;
// a failure rolls back to the last server-confirmed order AND repeats the
// server's own reason — a rollback discards every press the run had coalesced,
// so "排序未保存" alone would not say that the limiter clears in a minute.
//
// Motion (spec §11): M22 — the lifted row rides `Reorder.Item`'s own `layout`
// on SPRING_SNAPPY with `shadow-sm scale-[1.01]`; M21 — rows enter/leave the
// 成员创建 list through `LiveList`, and leave the official list through the same
// exit keyframes; M25 — the switch knob is a 160 ms CSS tween. Reduced motion
// zeroes all three. Chrome is ink; the dashed `#name` is the only member mark.

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AnimatePresence, Reorder, motion, useDragControls, useReducedMotion } from 'framer-motion';
import { ArrowDown, ArrowUp, Check, GripVertical, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { LiveList } from '@/components/motion';
import { currentLoginHref } from '@/lib/auth/callback-path';
import { EASE_OUT, SPRING_SNAPPY } from '@/lib/motion';
import { MAX_ZONE_COLUMNS, UNCATEGORIZED_COLUMN_PARAM, ZONE_LIMITS, zoneHref } from '@/lib/zones/shared';
import type { ZoneColumnView } from '@/lib/zones/types';
import {
  BTN_DANGER,
  BTN_GHOST,
  BTN_ICON,
  BTN_PRIMARY,
  BTN_SECONDARY,
  CARD_CLS,
  HINT_CLS,
  INPUT_CLS,
  LABEL_CLS,
  SELECT_CLS,
  readError,
} from './ui';

// ── Pure helpers (exported for tests) ────────────────────────────────────────

/** Official columns in display order, then member-created — the split every section renders from. */
export function splitColumns(columns: readonly ZoneColumnView[]): { official: ZoneColumnView[]; member: ZoneColumnView[] } {
  const official: ZoneColumnView[] = [];
  const member: ZoneColumnView[] = [];
  for (const c of columns) (c.official ? official : member).push(c);
  return { official, member };
}

/** Swap `index` with its neighbour `index + delta`; the same array when the move falls off either end. */
export function moveColumn<T>(items: readonly T[], index: number, delta: -1 | 1): T[] {
  const j = index + delta;
  if (index < 0 || index >= items.length || j < 0 || j >= items.length) return [...items];
  const next = [...items];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

export function sameOrder(a: readonly ZoneColumnView[], b: readonly ZoneColumnView[]): boolean {
  return a.length === b.length && a.every((c, i) => c.id === b[i].id);
}

/** Replace the row with `column.id` in place, or append it (a freshly created column). */
export function upsertColumn(columns: readonly ZoneColumnView[], column: ZoneColumnView): ZoneColumnView[] {
  const at = columns.findIndex((c) => c.id === column.id);
  if (at < 0) return [...columns, column];
  const next = [...columns];
  next[at] = column;
  return next;
}

/** 未归栏 = zone posts not filed under any column; never below 0 (counts are recomputed independently). */
export function uncategorizedCount(zonePostCount: number, columns: readonly ZoneColumnView[]): number {
  return Math.max(0, zonePostCount - columns.reduce((sum, c) => sum + c.postCount, 0));
}

/**
 * Whether swapping `index` with `index + delta` parks the row at that end of a
 * `total`-long list — the pressed arrow then disables, so focus must move to
 * its twin.
 */
export function movesToEnd(index: number, total: number, delta: -1 | 1): boolean {
  return delta === -1 ? index - 1 === 0 : index + 1 === total - 1;
}

/** The reorder session behind the coalesced ↑/↓ commit (see the header). */
export interface OrderSessionState {
  /** The last server-confirmed official order, captured by the first uncommitted move; null = no session. */
  base: readonly ZoneColumnView[] | null;
  /** A `{ orderedIds }` PATCH is in flight. */
  inFlight: boolean;
}

/**
 * What a flush should do: `defer` (a PATCH is in flight — mark dirty and let its
 * response reschedule), `noop` (no session, or the order is back where the
 * server already has it), or `send` the current order.
 */
export function planOrderFlush(s: OrderSessionState, current: readonly ZoneColumnView[]): 'defer' | 'noop' | 'send' {
  if (s.inFlight) return 'defer';
  if (!s.base || sameOrder(current, s.base)) return 'noop';
  return 'send';
}

/**
 * What to do with a reorder response: a failure ALWAYS rolls back to the base
 * (presses made during the flight go with it — the toast says restored); a
 * success while newer presses landed (`dirty`) must NOT be applied, since it
 * would clobber the order on screen — reschedule instead; otherwise apply.
 */
export function planOrderResponse(ok: boolean, dirty: boolean): 'rollback' | 'reschedule' | 'apply' {
  if (!ok) return 'rollback';
  return dirty ? 'reschedule' : 'apply';
}

/**
 * A 404 from `DELETE …/columns/<id> { moveToColumnId }` is ONE code for two
 * vanishings — the column itself, or the chosen move target
 * (lib/zones/columns.ts throws `column_not_found` for both); the re-read tells
 * them apart.
 */
export function vanishedOnDelete(fresh: readonly ZoneColumnView[], id: string): 'column' | 'target' {
  return fresh.some((c) => c.id === id) ? 'target' : 'column';
}

/** Quiet time after the last ↑/↓ before the coalesced order PATCH goes out. */
export const ORDER_COMMIT_DELAY_MS = 400;

// ── Editor ───────────────────────────────────────────────────────────────────

type Pending = 'toggle' | 'create' | 'reorder' | { id: string } | null;

interface EditDraft {
  name: string;
  description: string;
}

const ROW_CLS =
  'group relative rounded-lg border border-zinc-200 bg-white px-2 py-2 dark:border-zinc-800 dark:bg-zinc-950';

export function ColumnsEditor({
  zoneSlug,
  initialColumns,
  initialAllowMemberColumns,
  postCount,
  canManage,
}: {
  zoneSlug: string;
  initialColumns: ZoneColumnView[];
  initialAllowMemberColumns: boolean;
  /** `Zone.postCount` (published) — the 未归栏 line is this minus every column's count. */
  postCount: number;
  /** `access.canManage`: the switch PATCHes the zone itself (`manage`); the rest of the tab needs only `moderate`. */
  canManage: boolean;
}) {
  const t = useTranslations('zones');
  const router = useRouter();
  const reduce = useReducedMotion();
  const switchId = useId();
  const lockHintId = useId();

  const [columns, setColumns] = useState<ZoneColumnView[]>(initialColumns);
  const [allowMember, setAllowMember] = useState(initialAllowMemberColumns);
  const [pending, setPending] = useState<Pending>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  /** The server's localized `zone_columns_full` reason once it has said so (the button's title). */
  const [fullReason, setFullReason] = useState<string | null>(null);

  // A drag's onReorder fires on pointermove and onDragEnd on pointerup; the ref
  // hands the end handler the order the last move produced, whatever React has
  // committed by then.
  const columnsRef = useRef(columns);
  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);
  const dragStartRef = useRef<ZoneColumnView[] | null>(null);

  // Reorder session (header): base = the last server-confirmed official order,
  // timer = the pending coalesced commit, inFlight / dirty = the PATCH state.
  const orderBaseRef = useRef<ZoneColumnView[] | null>(null);
  const orderTimerRef = useRef<number | null>(null);
  const orderInFlightRef = useRef(false);
  const orderDirtyRef = useRef(false);
  const flushOrderRef = useRef<() => Promise<void>>(async () => {});
  /** Anything persisted since mount → the single router.refresh() on unmount. */
  const changedRef = useRef(false);

  useEffect(() => {
    return () => {
      // A press still waiting on its debounce goes out on the way out (the
      // state setters inside are no-ops once unmounted) and the RSC refresh
      // follows it, so the `?tab=` remount / zone home rail seed from what was
      // saved. Nothing changed ⇒ nothing to refresh.
      const timer = orderTimerRef.current;
      if (timer !== null) {
        window.clearTimeout(timer);
        orderTimerRef.current = null;
        void flushOrderRef.current().finally(() => router.refresh());
      } else if (changedRef.current) {
        router.refresh();
      }
    };
  }, [router]);

  const { official, member } = useMemo(() => splitColumns(columns), [columns]);
  const busy = pending !== null;
  const reordering = pending === 'reorder';
  const full = columns.length >= MAX_ZONE_COLUMNS;
  const uncategorized = uncategorizedCount(postCount, columns);
  const base = zoneHref(zoneSlug);

  // ── Requests ───────────────────────────────────────────────────────────────

  /** fetch with the house 401 → login redirect; null means "already handled". */
  async function request(path: string, init?: RequestInit): Promise<Response | null> {
    try {
      const res = await fetch(path, init);
      if (res.status === 401) {
        pushToast('error', t('login_required'));
        router.push(currentLoginHref());
        return null;
      }
      return res;
    } catch {
      pushToast('error', t('action_failed'));
      return null;
    }
  }

  async function failToast(res: Response): Promise<{ error: string; reason?: string }> {
    const err = await readError(res);
    pushToast('error', err.reason ?? t('action_failed'));
    return err;
  }

  function json(body: unknown, method: 'POST' | 'PATCH' | 'DELETE'): RequestInit {
    return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  }

  /** The authoritative re-read after a mutation (counts, order, the flag); the fresh list, or null when it could not be read. */
  async function reload(): Promise<ZoneColumnView[] | null> {
    const res = await request(`/api/zones/${zoneSlug}/columns`, { cache: 'no-store' });
    if (!res || !res.ok) return null;
    const data = (await res.json().catch(() => null)) as { items?: ZoneColumnView[]; allowMemberColumns?: boolean } | null;
    const items = Array.isArray(data?.items) ? data.items : null;
    if (items) setColumns(items);
    if (typeof data?.allowMemberColumns === 'boolean') setAllowMember(data.allowMemberColumns);
    return items;
  }

  /** A row the server no longer has (404 on a row mutation): re-read so the stale row leaves, and say so. */
  async function rowVanished(): Promise<void> {
    await reload();
    pushToast('error', t('columns_gone'));
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async function toggleAllowMember() {
    if (busy || !canManage) return;
    const next = !allowMember;
    setAllowMember(next);
    setPending('toggle');
    try {
      const res = await request(`/api/zones/${zoneSlug}`, json({ allowMemberColumns: next }, 'PATCH'));
      if (!res || !res.ok) {
        setAllowMember(!next);
        if (res) await failToast(res);
        return;
      }
      changedRef.current = true;
    } finally {
      setPending(null);
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || busy || full) return;
    setPending('create');
    try {
      const res = await request(
        `/api/zones/${zoneSlug}/columns`,
        json({ name, description: newDesc.trim(), official: true }, 'POST'),
      );
      if (!res) return;
      if (!res.ok) {
        const err = await failToast(res);
        if (err.error === 'columns_full' && err.reason) setFullReason(err.reason);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { column?: ZoneColumnView; created?: boolean };
      // 200 created:false = a same-named member column was PROMOTED, not duplicated.
      pushToast('success', data.created ? t('columns_created') : t('columns_promoted'));
      if (data.column) setColumns((cs) => upsertColumn(cs, data.column as ZoneColumnView));
      changedRef.current = true;
      setNewName('');
      setNewDesc('');
      await reload();
    } finally {
      setPending(null);
    }
  }

  /** Returns the server error code (for the inline 409) or null on success. */
  async function saveEdit(id: string, draft: EditDraft): Promise<string | null> {
    if (busy) return 'busy';
    setPending({ id });
    try {
      const res = await request(
        `/api/zones/${zoneSlug}/columns/${id}`,
        json({ name: draft.name.trim(), description: draft.description.trim() }, 'PATCH'),
      );
      if (!res) return 'unauthenticated';
      if (!res.ok) {
        const err = await readError(res);
        if (res.status === 404) {
          setEditingId(null);
          await rowVanished();
        } else if (err.error !== 'column_exists') {
          pushToast('error', err.reason ?? t('action_failed'));
        }
        return err.error;
      }
      const data = (await res.json().catch(() => ({}))) as { column?: ZoneColumnView };
      if (data.column) setColumns((cs) => upsertColumn(cs, data.column as ZoneColumnView));
      changedRef.current = true;
      setEditingId(null);
      pushToast('success', t('columns_saved'));
      await reload();
      return null;
    } finally {
      setPending(null);
    }
  }

  async function setOfficialFlag(id: string, official: boolean) {
    if (busy) return;
    setPending({ id });
    try {
      const res = await request(`/api/zones/${zoneSlug}/columns/${id}`, json({ official }, 'PATCH'));
      if (!res) return;
      if (!res.ok) {
        if (res.status === 404) await rowVanished();
        else await failToast(res);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { column?: ZoneColumnView };
      // The row changes section: drop it from its old place so the re-read's
      // order (official by sortOrder, member by postCount) is what lands.
      if (data.column) setColumns((cs) => [...cs.filter((c) => c.id !== id), data.column as ZoneColumnView]);
      changedRef.current = true;
      await reload();
    } finally {
      setPending(null);
    }
  }

  async function remove(id: string, moveToColumnId: string | null) {
    if (busy) return;
    setPending({ id });
    try {
      const res = await request(`/api/zones/${zoneSlug}/columns/${id}`, json({ moveToColumnId }, 'DELETE'));
      if (!res) return;
      if (!res.ok) {
        if (res.status === 404) {
          // The row itself gone → the panel closes with it; the move TARGET
          // gone → the panel stays over the refreshed options (its select
          // falls back to 未归栏) so the user picks again instead of retrying
          // the same vanished id.
          const fresh = await reload();
          const gone = fresh ? vanishedOnDelete(fresh, id) : 'column';
          if (gone === 'column') setConfirmId(null);
          pushToast('error', t(gone === 'column' ? 'columns_gone' : 'columns_target_gone'));
          return;
        }
        await failToast(res);
        return;
      }
      setConfirmId(null);
      setColumns((cs) => cs.filter((c) => c.id !== id));
      changedRef.current = true;
      pushToast('success', t('columns_deleted'));
      await reload();
    } finally {
      setPending(null);
    }
  }

  // ── Reorder session ────────────────────────────────────────────────────────

  /** Open a session on the first uncommitted move (the base is what a failure restores); a running session keeps its base. */
  function beginOrderSession(serverOrder: ZoneColumnView[]) {
    if (!orderBaseRef.current) orderBaseRef.current = serverOrder;
    setPending('reorder');
  }

  function endOrderSession() {
    orderBaseRef.current = null;
    orderDirtyRef.current = false;
    setPending(null);
  }

  function scheduleOrderCommit() {
    if (orderTimerRef.current !== null) window.clearTimeout(orderTimerRef.current);
    orderTimerRef.current = window.setTimeout(() => {
      orderTimerRef.current = null;
      void flushOrder();
    }, ORDER_COMMIT_DELAY_MS);
  }

  /** Send the current official order as ONE PATCH; the response decides apply / reschedule / rollback. */
  async function flushOrder(): Promise<void> {
    if (orderTimerRef.current !== null) {
      window.clearTimeout(orderTimerRef.current);
      orderTimerRef.current = null;
    }
    const serverOrder = orderBaseRef.current;
    const current = splitColumns(columnsRef.current).official;
    const plan = planOrderFlush({ base: serverOrder, inFlight: orderInFlightRef.current }, current);
    if (plan === 'defer') {
      orderDirtyRef.current = true;
      return;
    }
    if (plan === 'noop' || !serverOrder) {
      endOrderSession();
      return;
    }
    orderInFlightRef.current = true;
    orderDirtyRef.current = false;
    let ok = false;
    let items: ZoneColumnView[] | null = null;
    let reason: string | null = null;
    try {
      const res = await request(`/api/zones/${zoneSlug}/columns`, json({ orderedIds: current.map((c) => c.id) }, 'PATCH'));
      if (res?.ok) {
        ok = true;
        // The reorder response IS listZoneColumns() — the same list GET returns.
        const data = (await res.json().catch(() => ({}))) as { items?: ZoneColumnView[] };
        if (Array.isArray(data.items)) items = data.items;
      } else if (res) {
        // A rollback throws away every press the run had coalesced, so it has to
        // say WHY — `zone_rate_limited_column` (30/min, shared by every column
        // write) is the one a long reorder run can still hit, and "wait a moment"
        // is not something "已恢复原顺序" conveys on its own.
        reason = (await readError(res)).reason ?? null;
      }
    } finally {
      orderInFlightRef.current = false;
    }
    switch (planOrderResponse(ok, orderDirtyRef.current)) {
      case 'rollback':
        setColumns((cs) => [...serverOrder, ...splitColumns(cs).member]);
        pushToast('error', reason ? t('columns_reorder_failed_reason', { reason }) : t('columns_reorder_failed'));
        endOrderSession();
        return;
      case 'reschedule':
        scheduleOrderCommit();
        return;
      case 'apply':
        changedRef.current = true;
        endOrderSession();
        if (items) setColumns(items);
        else await reload();
    }
  }
  useEffect(() => {
    flushOrderRef.current = flushOrder;
  });

  function onReorder(nextOfficial: ZoneColumnView[]) {
    setColumns([...nextOfficial, ...member]);
  }

  function onDragStart() {
    dragStartRef.current = splitColumns(columnsRef.current).official;
    // A drop landing during an in-flight PATCH must not be clobbered by that response.
    if (orderInFlightRef.current) orderDirtyRef.current = true;
  }

  function onDragEnd() {
    const prev = dragStartRef.current;
    dragStartRef.current = null;
    if (!prev) return;
    beginOrderSession(prev);
    // A drop is one deliberate commit — no debounce.
    void flushOrder();
  }

  /** ↑/↓: applied locally at once, committed after the debounce. False = refused (another mutation pending / cannot move). */
  function move(index: number, delta: -1 | 1): boolean {
    if (pending !== null && !reordering) return false;
    const next = moveColumn(official, index, delta);
    if (sameOrder(next, official)) return false;
    beginOrderSession(official);
    setColumns([...next, ...member]);
    if (orderInFlightRef.current) orderDirtyRef.current = true;
    scheduleOrderCommit();
    return true;
  }

  function startEdit(id: string) {
    setConfirmId(null);
    setEditingId(id);
  }

  function startDelete(id: string) {
    setEditingId(null);
    setConfirmId(id);
  }

  const rowPending = (id: string) => typeof pending === 'object' && pending?.id === id;

  function renderBody(c: ZoneColumnView, index: number, grip?: ReactNode) {
    return (
      <ColumnRowBody
        column={c}
        grip={grip}
        editing={editingId === c.id}
        confirming={confirmId === c.id}
        busy={busy}
        rowBusy={rowPending(c.id)}
        others={columns.filter((o) => o.id !== c.id)}
        index={index}
        total={c.official ? official.length : member.length}
        onMove={(delta) => move(index, delta)}
        onStartEdit={() => startEdit(c.id)}
        onCancelEdit={() => setEditingId(null)}
        onSaveEdit={(draft) => saveEdit(c.id, draft)}
        onToggleOfficial={() => setOfficialFlag(c.id, !c.official)}
        onStartDelete={() => startDelete(c.id)}
        onCancelDelete={() => setConfirmId(null)}
        onConfirmDelete={(moveTo) => remove(c.id, moveTo)}
      />
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="max-w-xl text-sm text-zinc-600 dark:text-zinc-400">{t('columns_intro')}</p>
        <p className={HINT_CLS}>{t('columns_limit_hint', { count: columns.length, max: MAX_ZONE_COLUMNS })}</p>
      </div>

      {/* 允许成员自建栏目 */}
      <section className={`${CARD_CLS} flex items-start justify-between gap-6 p-4 sm:p-5`}>
        <div className="min-w-0">
          <label htmlFor={switchId} className="block text-sm font-medium">
            {t('columns_allow_member')}
          </label>
          <p className="mt-1 max-w-lg text-xs leading-relaxed text-muted">{t('columns_allow_member_desc')}</p>
          {!canManage && (
            <p id={lockHintId} className={HINT_CLS}>
              {t('columns_allow_member_locked')}
            </p>
          )}
        </div>
        <button
          id={switchId}
          type="button"
          role="switch"
          aria-checked={allowMember}
          aria-describedby={canManage ? undefined : lockHintId}
          disabled={busy || !canManage}
          onClick={toggleAllowMember}
          className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition disabled:opacity-60 ${
            allowMember ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-300 dark:bg-zinc-700'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] duration-[160ms] ease-out motion-reduce:transition-none dark:bg-zinc-950 ${
              allowMember ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </button>
      </section>

      {/* 官方栏目 */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">{t('columns_official_title', { count: official.length })}</h2>
        {official.length > 0 && (
          <Reorder.Group
            as="ul"
            axis="y"
            values={official}
            onReorder={onReorder}
            aria-label={t('columns_official_title', { count: official.length })}
            className="space-y-1.5"
          >
            <AnimatePresence initial={false}>
              {official.map((c, i) => (
                <OfficialItem
                  key={c.id}
                  column={c}
                  reduce={!!reduce}
                  // A drop during a reorder session joins it (the session base
                  // stays the server order), so only OTHER mutations lock the grip.
                  disabled={busy && !reordering}
                  gripLabel={t('columns_drag_handle')}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                >
                  {(grip) => renderBody(c, i, grip)}
                </OfficialItem>
              ))}
            </AnimatePresence>
          </Reorder.Group>
        )}
        <p className={HINT_CLS}>{t('columns_slug_stable')}</p>

        {/* 新建官方栏目 */}
        <form onSubmit={create} className={`${CARD_CLS} space-y-3 p-4 sm:p-5`}>
          <label className={LABEL_CLS}>{t('columns_new_title')}</label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="sm:w-56">
              <input
                value={newName}
                maxLength={ZONE_LIMITS.columnNameMax}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('columns_name_placeholder')}
                aria-label={t('columns_name_placeholder')}
                disabled={busy || full}
                className={INPUT_CLS}
              />
              <div className="mt-1 text-right font-mono text-[11px] tabular-nums text-zinc-400">
                {newName.length}/{ZONE_LIMITS.columnNameMax}
              </div>
            </div>
            <input
              value={newDesc}
              maxLength={ZONE_LIMITS.columnDescriptionMax}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder={t('columns_description_placeholder')}
              aria-label={t('columns_description_placeholder')}
              disabled={busy || full}
              className={`${INPUT_CLS} flex-1`}
            />
            <button
              type="submit"
              disabled={busy || full || !newName.trim()}
              title={full ? (fullReason ?? t('columns_full', { max: MAX_ZONE_COLUMNS })) : undefined}
              className={BTN_PRIMARY}
            >
              {pending === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {t('columns_add')}
            </button>
          </div>
        </form>
      </section>

      {/* 成员创建 */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">{t('columns_member_title', { count: member.length })}</h2>
        {member.length === 0 ? (
          <p className="text-sm text-muted">{t('columns_member_empty')}</p>
        ) : (
          <LiveList
            items={member}
            keyOf={(c) => c.id}
            className="space-y-1.5"
            itemClassName={ROW_CLS}
            render={(c, i) => renderBody(c, i)}
          />
        )}
      </section>

      {/* 未归栏 */}
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        <Link
          href={`${base}?column=${UNCATEGORIZED_COLUMN_PARAM}`}
          className="underline decoration-zinc-300 underline-offset-4 transition hover:text-zinc-900 hover:decoration-zinc-900 dark:decoration-zinc-700 dark:hover:text-zinc-100 dark:hover:decoration-zinc-100"
        >
          {t('columns_uncategorized', { count: uncategorized })}
        </Link>
      </p>
    </div>
  );
}

// ── Official row (Reorder.Item + grip-only drag) ─────────────────────────────

function OfficialItem({
  column,
  reduce,
  disabled,
  gripLabel,
  onDragStart,
  onDragEnd,
  children,
}: {
  column: ZoneColumnView;
  reduce: boolean;
  disabled: boolean;
  gripLabel: string;
  onDragStart: () => void;
  onDragEnd: () => void;
  children: (grip: ReactNode) => ReactNode;
}) {
  const controls = useDragControls();
  const [dragging, setDragging] = useState(false);

  // `dragListener={false}`: only the grip starts a drag, so the name button,
  // the inline inputs and the action buttons keep their own pointer semantics.
  // The grip is POINTER-ONLY — a drag has no keyboard action — so it stays out
  // of the tab order and the accessibility tree (a focusable "button" that does
  // nothing on Enter is a trap); the ↑/↓ twins on the row are the keyboard
  // reorder. `title` keeps the mouse hint.
  const grip = (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      title={gripLabel}
      disabled={disabled}
      onPointerDown={(e) => {
        if (disabled) return;
        e.preventDefault();
        controls.start(e);
      }}
      style={{ touchAction: 'none' }}
      className={`${BTN_ICON} cursor-grab active:cursor-grabbing`}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );

  return (
    <Reorder.Item
      value={column}
      dragListener={false}
      dragControls={controls}
      whileDrag={reduce ? undefined : { scale: 1.01 }}
      onDragStart={() => {
        setDragging(true);
        onDragStart();
      }}
      onDragEnd={() => {
        setDragging(false);
        onDragEnd();
      }}
      // Opacity only: `y` is the drag axis' own motion value (dragSnapToOrigin
      // returns it to 0), so an entrance keyframe on it would fight the drag.
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0, overflow: 'hidden' }}
      transition={reduce ? { duration: 0 } : SPRING_SNAPPY}
      className={`${ROW_CLS} select-none ${dragging ? 'z-10 shadow-sm' : ''}`}
    >
      {children(grip)}
    </Reorder.Item>
  );
}

// ── Row body (shared by official + member rows) ──────────────────────────────

function ColumnRowBody({
  column,
  grip,
  editing,
  confirming,
  busy,
  rowBusy,
  others,
  index,
  total,
  onMove,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onToggleOfficial,
  onStartDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  column: ZoneColumnView;
  grip?: ReactNode;
  editing: boolean;
  confirming: boolean;
  busy: boolean;
  rowBusy: boolean;
  others: ZoneColumnView[];
  index: number;
  total: number;
  /** True when the press was taken (focus may then follow the row); false when refused. */
  onMove: (delta: -1 | 1) => boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (draft: EditDraft) => Promise<string | null>;
  onToggleOfficial: () => void;
  onStartDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: (moveToColumnId: string | null) => void;
}) {
  const t = useTranslations('zones');
  const reduce = useReducedMotion();
  const upRef = useRef<HTMLButtonElement>(null);
  const downRef = useRef<HTMLButtonElement>(null);
  const trashRef = useRef<HTMLButtonElement>(null);
  const name = column.official ? column.name : `#${column.name}`;
  const canMoveUp = column.official && index > 0;
  const canMoveDown = column.official && index < total - 1;

  // A move that parks the row at either end disables the arrow that was just
  // pressed; Chrome drops focus from a disabled button to <body>, which would
  // strand a keyboard user — hand it to the twin. Only once the press was
  // actually TAKEN (a refused press must leave focus where it is, or the next
  // Enter moves the row the other way), and after React has committed: on a
  // two-row list the twin is itself disabled until that render.
  function moveBy(delta: -1 | 1) {
    if (!onMove(delta)) return;
    if (!movesToEnd(index, total, delta)) return;
    const twin = delta === -1 ? downRef : upRef;
    window.requestAnimationFrame(() => twin.current?.focus());
  }

  // The confirm panel takes focus while open (so Escape works); closing it
  // hands focus back to the control that opened it instead of dropping to <body>.
  function cancelDelete() {
    onCancelDelete();
    window.requestAnimationFrame(() => trashRef.current?.focus());
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {grip}
        <div className="min-w-0 flex-1">
          {editing ? (
            <EditForm column={column} busy={rowBusy} onCancel={onCancelEdit} onSave={onSaveEdit} />
          ) : (
            <button
              type="button"
              onClick={onStartEdit}
              disabled={busy}
              title={t('columns_rename')}
              className="block w-full rounded-md py-0.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 disabled:cursor-default"
            >
              <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{name}</span>
              {column.description && <span className="block truncate text-xs text-muted">{column.description}</span>}
              {!column.official && column.createdBy && (
                <span className="block truncate text-xs text-muted">{t('columns_by', { name: column.createdBy })}</span>
              )}
            </button>
          )}
        </div>
        <span
          className="font-mono text-xs tabular-nums text-zinc-500"
          title={t('columns_post_count', { count: column.postCount })}
        >
          {column.postCount}
        </span>
        {!editing && (
          <div className="flex w-full items-center justify-end gap-0.5 sm:w-auto">
            {column.official && (
              // The keyboard twin of the drag: revealed on hover / focus-within
              // on desktop, always shown where there is no hover (phones).
              <span className="flex items-center gap-0.5 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                <button
                  ref={upRef}
                  type="button"
                  onClick={() => moveBy(-1)}
                  // Not `disabled` while busy: a disabled button drops focus to
                  // <body>, which would strand the keyboard user mid-reorder.
                  // `move()` refuses a press only while ANOTHER mutation is
                  // pending; presses during a reorder commit are coalesced.
                  disabled={!canMoveUp}
                  aria-label={t('columns_move_up')}
                  title={t('columns_move_up')}
                  className={BTN_ICON}
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  ref={downRef}
                  type="button"
                  onClick={() => moveBy(1)}
                  disabled={!canMoveDown}
                  aria-label={t('columns_move_down')}
                  title={t('columns_move_down')}
                  className={BTN_ICON}
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              </span>
            )}
            <button type="button" onClick={onToggleOfficial} disabled={busy} className={BTN_GHOST}>
              {rowBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {column.official ? t('columns_unofficial') : t('columns_make_official')}
            </button>
            <button
              type="button"
              onClick={onStartEdit}
              disabled={busy}
              aria-label={t('columns_rename')}
              title={t('columns_rename')}
              className={BTN_ICON}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              ref={trashRef}
              type="button"
              onClick={confirming ? cancelDelete : onStartDelete}
              disabled={busy}
              aria-label={t('columns_delete')}
              title={t('columns_delete')}
              aria-expanded={confirming}
              className={BTN_ICON}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <AnimatePresence initial={false}>
        {confirming && (
          <DeleteConfirm
            column={column}
            others={others}
            busy={rowBusy}
            reduce={!!reduce}
            onCancel={cancelDelete}
            onConfirm={onConfirmDelete}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Inline rename / describe ─────────────────────────────────────────────────

function EditForm({
  column,
  busy,
  onCancel,
  onSave,
}: {
  column: ZoneColumnView;
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: EditDraft) => Promise<string | null>;
}) {
  const t = useTranslations('zones');
  const [name, setName] = useState(column.name);
  const [description, setDescription] = useState(column.description);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const clean = name.trim();
    if (!clean) return;
    if (clean === column.name && description.trim() === column.description) {
      onCancel();
      return;
    }
    setError(null);
    const code = await onSave({ name: clean, description });
    // 409 stays inline next to the field that caused it; everything else toasted upstream.
    if (code === 'column_exists') setError(t('columns_exists'));
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <div className="sm:w-48">
        <input
          value={name}
          maxLength={ZONE_LIMITS.columnNameMax}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKey}
          autoFocus
          aria-label={t('columns_name_placeholder')}
          aria-invalid={error ? true : undefined}
          placeholder={t('columns_name_placeholder')}
          className={`${INPUT_CLS} h-8 ${error ? 'border-danger focus:border-danger' : ''}`}
        />
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </div>
      <input
        value={description}
        maxLength={ZONE_LIMITS.columnDescriptionMax}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={onKey}
        aria-label={t('columns_description_placeholder')}
        placeholder={t('columns_description_placeholder')}
        className={`${INPUT_CLS} h-8 flex-1`}
      />
      <div className="flex items-center gap-1">
        <button type="submit" disabled={busy || !name.trim()} className={`${BTN_PRIMARY} h-8 px-3 text-xs`}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {t('save')}
        </button>
        <button type="button" onClick={onCancel} className={`${BTN_SECONDARY} h-8 px-3 text-xs`}>
          <X className="h-3.5 w-3.5" />
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

// ── Delete confirm (inline .surface panel) ───────────────────────────────────

function DeleteConfirm({
  column,
  others,
  busy,
  reduce,
  onCancel,
  onConfirm,
}: {
  column: ZoneColumnView;
  others: ZoneColumnView[];
  busy: boolean;
  reduce: boolean;
  onCancel: () => void;
  onConfirm: (moveToColumnId: string | null) => void;
}) {
  const t = useTranslations('zones');
  const selectId = useId();
  const selectRef = useRef<HTMLSelectElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [moveTo, setMoveTo] = useState('');

  // The panel must TAKE focus in every variant — Escape is handled on the form,
  // and a column with no posts renders no select (which used to be the only
  // autoFocus): the panel opened with focus still on the 🗑 trigger outside it,
  // and Escape was dead until the user tabbed in. The select when present (the
  // one decision to make), else 取消 — never 删除, so a stray Enter cannot
  // destroy what the user has not looked at.
  useEffect(() => {
    (selectRef.current ?? cancelRef.current)?.focus();
  }, []);

  // `others` is the live list: a target another moderator deleted meanwhile
  // leaves the options on the re-read, and the choice falls back to 未归栏
  // rather than resubmitting the vanished id.
  useEffect(() => {
    if (moveTo && !others.some((o) => o.id === moveTo)) setMoveTo('');
  }, [moveTo, others]);

  return (
    <motion.form
      role="group"
      aria-label={t('columns_delete_title', { name: column.name })}
      initial={{ opacity: 0, y: reduce ? 0 : 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduce ? 0 : 4 }}
      transition={{ duration: reduce ? 0 : 0.2, ease: EASE_OUT }}
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm(moveTo || null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      className="surface mt-2 space-y-3 rounded-xl p-3 sm:p-4"
    >
      <div>
        <h3 className="text-sm font-semibold">{t('columns_delete_title', { name: column.name })}</h3>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{t('columns_delete_body', { count: column.postCount })}</p>
      </div>
      {column.postCount > 0 && (
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
          <label htmlFor={selectId} className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {t('columns_delete_move_to')}
          </label>
          <select
            id={selectId}
            ref={selectRef}
            value={moveTo}
            onChange={(e) => setMoveTo(e.target.value)}
            className={`${SELECT_CLS} sm:min-w-[14rem]`}
          >
            <option value="">{t('columns_delete_uncategorized')}</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.official ? o.name : `#${o.name}`}
              </option>
            ))}
          </select>
        </div>
      )}
      <p className="text-xs text-muted">{t('columns_delete_note')}</p>
      <div className="flex justify-end gap-2">
        <button ref={cancelRef} type="button" onClick={onCancel} className={`${BTN_SECONDARY} h-8 px-3 text-xs`}>
          {t('cancel')}
        </button>
        <button type="submit" disabled={busy} className={`${BTN_DANGER} h-8 px-3 text-xs`}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          {t('delete')}
        </button>
      </div>
    </motion.form>
  );
}
