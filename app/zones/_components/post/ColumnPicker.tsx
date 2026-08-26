'use client';

// 栏目 picker (ask #2). A combobox over the zone's columns: 官方栏目 first
// (marked), then member-created ones by post count, plus 未归栏. When the zone
// allows it (`allowCreate = zone.allowMemberColumns || access.canModerate`) a
// free-text name that matches nothing becomes a NEW column — the composer sends
// it as `columnName` and the server creates it inside the post transaction
// (lib/zones/columns.ts#getOrCreateColumn), so nothing is created for a post
// that is never saved.
//
// The value is the two-field contract the API takes: `columnId` (an existing
// column) XOR `columnName` (create on save); both null = 未归栏. Typing the
// exact name of an existing column resolves to its id (columnDedupeKey) instead
// of creating a duplicate — the same key the server dedupes on.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronDown, FolderPlus, Plus, Search, X } from 'lucide-react';
import { ZONE_LIMITS, columnDedupeKey, normalizeColumnName } from '@/lib/zones/shared';
import type { ZoneColumnView } from '@/lib/zones/types';

export interface ColumnPick {
  /** An existing column. */
  columnId: string | null;
  /** …or a name to create on save (wins over `columnId` server-side). */
  columnName: string | null;
}

export const NO_COLUMN: ColumnPick = { columnId: null, columnName: null };

/** Resolve a typed name against the existing columns (same dedupe key as the server). */
export function matchColumnByName(columns: readonly ZoneColumnView[], name: string): ZoneColumnView | null {
  const key = columnDedupeKey(name);
  if (!key) return null;
  return columns.find((c) => columnDedupeKey(c.name) === key) ?? null;
}

export function ColumnPicker({
  columns,
  value,
  onChange,
  allowCreate,
  disabled = false,
}: {
  columns: ZoneColumnView[];
  value: ColumnPick;
  onChange: (next: ColumnPick) => void;
  allowCreate: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations('zones');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = value.columnId ? (columns.find((c) => c.id === value.columnId) ?? null) : null;
  const pendingName = value.columnName ? normalizeColumnName(value.columnName) : '';

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const typed = normalizeColumnName(q);
  const filtered = useMemo(() => {
    const key = columnDedupeKey(q);
    if (!key) return columns;
    return columns.filter((c) => columnDedupeKey(c.name).includes(key));
  }, [columns, q]);
  const exact = typed ? matchColumnByName(columns, typed) : null;
  const tooLong = [...typed].length > ZONE_LIMITS.columnNameMax;
  const canCreate = allowCreate && typed.length > 0 && !exact && !tooLong;

  function pickExisting(column: ZoneColumnView) {
    onChange({ columnId: column.id, columnName: null });
    setOpen(false);
    setQ('');
  }

  function pickNone() {
    onChange(NO_COLUMN);
    setOpen(false);
    setQ('');
  }

  function createTyped() {
    if (exact) {
      pickExisting(exact);
      return;
    }
    if (!canCreate) return;
    onChange({ columnId: null, columnName: typed });
    setOpen(false);
    setQ('');
  }

  const label = selected ? selected.name : pendingName || t('composer_column_none');

  return (
    <div ref={rootRef} className="relative">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="inline-flex h-9 max-w-full items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 transition hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:border-zinc-600"
        >
          <span className={`truncate ${selected || pendingName ? 'font-medium' : 'text-muted'}`}>{label}</span>
          {pendingName && !selected && (
            <span className="shrink-0 rounded-full border border-dashed border-zinc-400 px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-muted dark:border-zinc-600">
              {t('composer_column_new_badge')}
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
        </button>
        {(selected || pendingName) && !disabled && (
          <button
            type="button"
            onClick={pickNone}
            aria-label={t('composer_column_none')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && !disabled && (
        <div className="surface absolute left-0 top-full z-30 mt-2 w-full max-w-sm rounded-xl p-2 shadow-lg">
          <label className="flex h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3 dark:border-zinc-800">
            {allowCreate ? <FolderPlus className="h-4 w-4 shrink-0 text-muted" /> : <Search className="h-4 w-4 shrink-0 text-muted" />}
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (exact) pickExisting(exact);
                else if (canCreate) createTyped();
                else if (filtered.length > 0) pickExisting(filtered[0]);
              }}
              maxLength={ZONE_LIMITS.columnNameMax + 12}
              placeholder={allowCreate ? t('composer_column_search') : t('composer_column_search_only')}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            />
          </label>

          {tooLong && <p className="px-2 pt-1.5 text-[11px] text-danger">{t('composer_column_too_long', { max: ZONE_LIMITS.columnNameMax })}</p>}

          <ul role="listbox" className="mt-1 max-h-64 overflow-y-auto scroll-thin">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={!selected && !pendingName}
                onClick={pickNone}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-muted transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <Check className={`h-3.5 w-3.5 shrink-0 ${!selected && !pendingName ? '' : 'invisible'}`} aria-hidden />
                {t('composer_column_none')}
              </button>
            </li>
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected?.id === c.id}
                  onClick={() => pickExisting(c)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Check className={`h-3.5 w-3.5 shrink-0 ${selected?.id === c.id ? '' : 'invisible'}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{c.name}</span>
                      {c.official && (
                        <span className="shrink-0 rounded-full border border-zinc-300 px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-muted dark:border-zinc-700">
                          {t('composer_column_official')}
                        </span>
                      )}
                    </span>
                    {c.description && <span className="mt-0.5 block truncate text-[11px] text-muted">{c.description}</span>}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">{t('composer_column_posts', { count: c.postCount })}</span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && !canCreate && <li className="px-2 py-4 text-center text-xs text-muted">{t('composer_column_empty')}</li>}
            {canCreate && (
              <li>
                <button
                  type="button"
                  onClick={createTyped}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 truncate">{t('composer_column_create', { name: typed })}</span>
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
