'use client';

// The @人 popup. Mounted ONCE by RichTextEditor, so every one of its ~20 call
// sites (zone posts + comments, 讨论区 posts/topics/replies, video comments,
// 意见反馈, skills, events, 知识库) gets mentions without a per-surface prop.
//
// Three things are deliberate:
//
// 1. PORTALED via `useAnchoredPanel`, anchored to the suggestion plugin's own
//    decoration span. The editor root is `overflow-hidden` and several hosts
//    additionally sit in a transformed / clipped card, so an in-flow popup is
//    clipped at any z-index — the same reason DeptTag, the navbar menu and the
//    zone header menus all portal. The hook also gives us flip-above, viewport
//    clamping and close-when-the-caret-scrolls-away for free.
//
// 2. THE SEARCH IS THE SERVER'S. `/api/users/search` already does the smart
//    matching the owner asked for (case-insensitive, name tokens in any order,
//    工号 by digit run) and already trims identity for 隐私账号. This component
//    only debounces, aborts and caches — it never filters, never ranks, and
//    never renders a field the payload did not send.
//
// 3. FOCUS STAYS IN THE EDITOR. The contenteditable is the focused combobox, so
//    the rows are `mousedown`-neutralised (a blur mid-click would cancel the
//    pick) and `aria-activedescendant` / `aria-controls` / `aria-expanded` are
//    written onto the editable itself — that is the element a screen reader is
//    on. ↑/↓/Enter/Esc arrive from the suggestion plugin's `handleKeyDown` (see
//    RichTextEditor), never from a listener of our own, which is what lets an
//    IME composition keystroke (keyCode 229) be told apart from navigation.

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MutableRefObject,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { AtSign, Loader2 } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { useAnchoredPanel } from '@/components/useAnchoredPanel';
import { useListboxNav } from '@/components/zones/useListboxNav';
import { SPRING_SNAPPY, TWEEN_FAST } from '@/lib/motion';
import type { MentionSession } from './mention-suggestion';

/** Exactly the `SearchPersonView` the route returns — already privacy-trimmed. */
export interface MentionPerson {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  department: string | null;
  lab: string | null;
  isPrivate: boolean;
}

const DEBOUNCE_MS = 160;
const PANEL_W = 320;
const PANEL_H = 260;
/**
 * Keys the popup owns while it is open. Home/End stay the EDITOR's — a caret in
 * a text field is expected to obey them, and the list is at most 8 rows.
 */
const NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Enter']);

// One result set per query for the life of the page: backspacing through a
// query must not re-hit the endpoint for something we already have.
const cache = new Map<string, MentionPerson[]>();
const CACHE_MAX = 60;
function remember(query: string, items: MentionPerson[]) {
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(query, items);
}

/** useListboxNav speaks React events; the plugin hands us native ones. */
function asReactKey(event: KeyboardEvent): ReactKeyboardEvent<HTMLElement> {
  return {
    key: event.key,
    nativeEvent: event,
    preventDefault: () => event.preventDefault(),
  } as unknown as ReactKeyboardEvent<HTMLElement>;
}

export function MentionPicker({
  session,
  keyRef,
}: {
  session: MentionSession | null;
  /** RichTextEditor points the suggestion plugin's keydown hook at this. */
  keyRef: MutableRefObject<(event: KeyboardEvent) => boolean>;
}) {
  const t = useTranslations('ui');
  const reduce = useReducedMotion();
  const listId = useId();

  // Esc / an outside click / a blur closes THIS query. Keyed on session + query
  // so the next keystroke re-opens the list (GitHub's behaviour) instead of
  // going silent for the rest of the sentence.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const sessionKey = session ? `${session.id} ${session.query}` : null;
  const sessionKeyRef = useRef<string | null>(sessionKey);
  sessionKeyRef.current = sessionKey;
  const dismiss = useCallback(() => setDismissed(sessionKeyRef.current), []);

  const visible = Boolean(session) && sessionKey !== dismissed;
  const query = visible && session ? session.query.trim() : '';

  const [items, setItems] = useState<MentionPerson[]>([]);
  const [loading, setLoading] = useState(false);

  const panel = useAnchoredPanel<HTMLElement>({
    width: PANEL_W,
    height: PANEL_H,
    align: 'left',
    onClose: dismiss,
  });
  const { openPanel, close, place, panelRef, triggerRef, host, pos, open } = panel;

  // Anchor to the LIVE decoration span (ProseMirror rebuilds it as the query
  // grows), then measure. Opening and re-placing share one call site so the
  // panel can never paint at a stale rect.
  const anchor = session?.anchor ?? null;
  useEffect(() => {
    if (!visible || !anchor) {
      if (open) close();
      return;
    }
    triggerRef.current = anchor;
    if (open) place();
    else openPanel();
  }, [visible, anchor, open, close, place, openPanel, triggerRef]);

  // Debounced + abortable search. Previous results stay on screen while the
  // next ones load: clearing them made every keystroke flash an empty panel.
  useEffect(() => {
    if (!visible || !query) {
      setItems([]);
      setLoading(false);
      return;
    }
    const hit = cache.get(query);
    if (hit) {
      setItems(hit);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      // Root-relative on purpose — lib/patch-fetch.ts adds the deploy basePath.
      fetch(`/api/users/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal })
        .then(async (res) => {
          const data = (await res.json().catch(() => null)) as { items?: MentionPerson[] } | null;
          const list = res.ok && Array.isArray(data?.items) ? (data.items as MentionPerson[]) : [];
          remember(query, list);
          setItems(list);
          setLoading(false);
        })
        .catch(() => {
          // Abort is the common case (the next keystroke). A real failure just
          // shows the empty state — a composer must never toast for a typeahead.
          if (!ctrl.signal.aborted) {
            setItems([]);
            setLoading(false);
          }
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [visible, query]);

  const pick = useCallback(
    (i: number) => {
      const person = items[i];
      if (!person || !session) return;
      session.select({ handle: person.handle, displayName: person.displayName });
    },
    [items, session],
  );

  const nav = useListboxNav(items.length, pick);
  const { setActive } = nav;
  useEffect(() => setActive(0), [query, setActive]);

  // The suggestion plugin's keydown hook. Assigned on every render so it always
  // closes over the current rows and highlight.
  keyRef.current = (event: KeyboardEvent): boolean => {
    if (!visible) return false;
    // 中文 / 日文 IME: the composition's own Enter and arrows belong to the
    // candidate window, never to this list.
    if (event.isComposing || event.keyCode === 229) return false;
    if (event.key === 'Escape') {
      dismiss();
      return true;
    }
    if (items.length === 0 || !NAV_KEYS.has(event.key)) return false;
    nav.onKeyDown(asReactKey(event));
    return true;
  };

  // The editable IS the combobox: it holds focus, so it holds the ARIA state.
  const editorDom = session?.editorDom ?? null;
  useEffect(() => {
    if (!visible || !editorDom) return;
    editorDom.setAttribute('aria-expanded', 'true');
    editorDom.setAttribute('aria-controls', listId);
    return () => {
      editorDom.removeAttribute('aria-expanded');
      editorDom.removeAttribute('aria-controls');
      editorDom.removeAttribute('aria-activedescendant');
    };
  }, [visible, editorDom, listId]);

  useEffect(() => {
    if (!visible || !editorDom) return;
    if (nav.activeId) editorDom.setAttribute('aria-activedescendant', nav.activeId);
    else editorDom.removeAttribute('aria-activedescendant');
  }, [visible, editorDom, nav.activeId]);

  // Leaving the editor closes the list. Rows neutralise `mousedown`, so a click
  // on a row never reaches this.
  useEffect(() => {
    if (!visible || !editorDom) return;
    const onBlur = () => dismiss();
    editorDom.addEventListener('blur', onBlur);
    return () => editorDom.removeEventListener('blur', onBlur);
  }, [visible, editorDom, dismiss]);

  if (!visible || !open || !host || !pos) return null;

  const spring = reduce ? { duration: 0 } : SPRING_SNAPPY;

  return createPortal(
    <motion.div
      ref={panelRef}
      role="presentation"
      initial={reduce ? false : { opacity: 0, y: pos.up ? 4 : -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : TWEEN_FAST}
      style={{ position: 'fixed', left: pos.left, top: pos.top, maxHeight: pos.maxHeight }}
      className="z-[115] flex w-[min(20rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
    >
      <LayoutGroup id="mention-rows">
        <ul
          ref={nav.listRef}
          id={listId}
          role="listbox"
          aria-label={t('mention_label')}
          className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1"
        >
          {items.map((p, i) => {
            const active = nav.active === i;
            return (
              <li key={p.userId} id={nav.optionId(i)} data-index={i} role="option" aria-selected={active}>
                <button
                  type="button"
                  tabIndex={-1}
                  // Keep the caret (and the suggestion range) alive through the click.
                  onMouseDown={(e) => e.preventDefault()}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => pick(i)}
                  className="relative flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none"
                >
                  {active && (
                    <motion.span
                      layoutId="mention-pill"
                      aria-hidden
                      transition={spring}
                      className="absolute inset-0 rounded-lg bg-zinc-100 dark:bg-zinc-800/70"
                    />
                  )}
                  <span className="relative shrink-0">
                    {/* No `handle`: a hover card must not stack on top of the picker. */}
                    <Avatar name={p.displayName} src={p.avatarUrl} size="sm" />
                  </span>
                  <span className="relative min-w-0 flex-1">
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className="truncate text-[13px] font-medium">{p.displayName}</span>
                      {/* 隐私账号: the handle TEXT is hidden; the profile link still works. */}
                      {!p.isPrivate && (
                        <span className="shrink-0 truncate font-mono text-[11px] text-muted">@{p.handle}</span>
                      )}
                    </span>
                    <DeptTag department={p.department} lab={p.lab} className="mt-0.5" />
                  </span>
                </button>
              </li>
            );
          })}

          {items.length === 0 && (
            <li className="flex items-center gap-2 px-2 py-3 text-[13px] text-muted">
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : (
                <AtSign className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="min-w-0 truncate">
                {loading ? t('mention_loading') : query ? t('mention_empty') : t('mention_hint')}
              </span>
            </li>
          )}
        </ul>
      </LayoutGroup>
    </motion.div>,
    host,
  );
}

export default MentionPicker;
