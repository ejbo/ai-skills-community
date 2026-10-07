'use client';

// The house people picker — chips + a type-to-search box over the ONE site-wide people
// endpoint `GET /api/users/search?q=` (姓名 order-insensitive tokens, 工号 on its digit run;
// rows already trimmed through `toPublicAuthor`, the 工号 matched but never returned).
//
// Used by 合著者 (app/zones/_components/post/CoauthorPicker.tsx) and 指定成员可见
// (components/audience/VisibilityField.tsx). Callers bring their own copy (`labels`) and
// cap (`max`); they do not fork this file — the like-button lesson.
//
// The endpoint answers NOTHING for an empty query (a site-wide roster dump is not a
// picker), so the box shows a prompt until the viewer types. `userId` rides alongside
// the trimmed PublicAuthor because save APIs want ids while the chip shows the identity.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Loader2, Search, UserPlus, X } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import type { PublicAuthor } from '@/lib/user-identity';

export interface PersonPick {
  userId: string;
  user: PublicAuthor;
}

/** `SearchPersonView` from app/api/users/search — restated so a client leaf never imports a route module. */
interface PersonResult extends PublicAuthor {
  userId: string;
}

export interface PeoplePickerLabels {
  /** The dashed 「+ 添加」 chip. */
  add: string;
  /** Search box placeholder / aria-label. */
  search: string;
  /** Shown under an empty box. */
  prompt: string;
  noMatch: string;
  /** aria-label of a chip's ✕. */
  remove: (name: string) => string;
}

const DEBOUNCE_MS = 200;

export function PeoplePicker({
  value,
  onChange,
  labels,
  max,
  excludeHandles = [],
  disabled = false,
  showCount = true,
  closeOnPick = true,
  panel = 'popover',
}: {
  value: PersonPick[];
  onChange: (next: PersonPick[]) => void;
  labels: PeoplePickerLabels;
  max: number;
  /** Never offered (e.g. the author themselves — they are implicit). */
  excludeHandles?: readonly string[];
  disabled?: boolean;
  /** The `n/max` counter beside the chips. */
  showCount?: boolean;
  /** Close the search after each pick (合著者: usually one) or stay open (a visibility list: usually several). */
  closeOnPick?: boolean;
  /**
   * `popover` floats the search over the page; `inline` expands it in the flow. Use
   * `inline` inside anything that scrolls or clips (a dialog body is `overflow-y-auto`
   * — a floating panel there gets cut at the dialog edge, hiding most results).
   */
  panel?: 'popover' | 'inline';
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PersonResult[]>([]);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const full = value.length >= max;
  const query = q.trim();

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    // An empty box asks for nothing: the endpoint answers `[]` anyway, and
    // firing it would only cost a request per open.
    if (!open || !query) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/users/search?q=${encodeURIComponent(query)}`)
        .then(async (res) => {
          if (cancelled) return;
          const data = (await res.json().catch(() => null)) as { items?: PersonResult[] } | null;
          setResults(res.ok && Array.isArray(data?.items) ? data.items : []);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  const excludeKey = excludeHandles.join('\n');
  const candidates = useMemo(() => {
    const picked = new Set(value.map((c) => c.userId));
    const excluded = new Set(excludeKey ? excludeKey.split('\n') : []);
    return results.filter((p) => !excluded.has(p.handle) && !picked.has(p.userId));
  }, [results, value, excludeKey]);

  // The highlighted row must never point past the list (results change per keystroke).
  useEffect(() => {
    setActive(0);
  }, [candidates.length, query]);

  function pick(p: PersonResult) {
    if (full) return;
    const { userId, ...user } = p;
    onChange([...value, { userId, user }]);
    setQ('');
    if (closeOnPick || value.length + 1 >= max) setOpen(false);
  }

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (candidates.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % candidates.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + candidates.length) % candidates.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(candidates[Math.min(active, candidates.length - 1)]);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((c) => (
          <span
            key={c.userId}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 py-0.5 pl-0.5 pr-2 text-xs dark:border-zinc-700"
          >
            <Avatar name={c.user.displayName} src={c.user.avatarUrl} size="xs" handle={c.user.handle} />
            <span>{c.user.displayName}</span>
            <DeptTag department={c.user.department} lab={c.user.lab} />
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x.userId !== c.userId))}
                aria-label={labels.remove(c.user.displayName)}
                className="rounded-full text-muted transition hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        {!disabled && !full && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-zinc-300 px-2.5 text-xs text-muted transition hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:text-zinc-100"
          >
            <UserPlus className="h-3.5 w-3.5" />
            {labels.add}
          </button>
        )}
        {showCount && (
          <span className="font-mono text-[11px] tabular-nums text-muted">
            {value.length}/{max}
          </span>
        )}
      </div>

      {open && !disabled && (
        <div
          className={
            panel === 'inline'
              ? 'mt-2 w-full max-w-md rounded-xl border border-zinc-200 p-2 dark:border-zinc-800'
              : 'surface absolute left-0 top-full z-30 mt-2 w-full max-w-md rounded-xl p-2 shadow-lg'
          }
        >
          <label className="flex h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3 dark:border-zinc-800">
            <Search className="h-4 w-4 shrink-0 text-muted" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder={labels.search}
              aria-label={labels.search}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            />
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
          </label>
          <ul className="mt-1 max-h-64 overflow-y-auto scroll-thin">
            {candidates.map((p, i) => (
              <li key={p.userId}>
                <button
                  type="button"
                  onClick={() => pick(p)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition ${
                    i === active ? 'bg-zinc-100 dark:bg-zinc-800' : ''
                  }`}
                >
                  <Avatar name={p.displayName} src={p.avatarUrl} size="sm" />
                  {/* The NAME owns the first line: in a narrow settings column a full
                      org path would otherwise squeeze it down to "Bob…". */}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.displayName}</span>
                    <span className="flex min-w-0 items-center gap-1.5">
                      {/* 隐私账号: the @handle TEXT is hidden (it is the W3 工号 for SSO accounts). */}
                      {!p.isPrivate && <span className="shrink-0 font-mono text-xs text-muted">@{p.handle}</span>}
                      <DeptTag department={p.department} lab={p.lab} />
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {!query && <li className="px-2 py-4 text-center text-xs text-muted">{labels.prompt}</li>}
            {query && !loading && candidates.length === 0 && (
              <li className="px-2 py-4 text-center text-xs text-muted">{labels.noMatch}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
