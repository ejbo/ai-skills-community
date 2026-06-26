'use client';

// A per-skill chat store that lives at module scope, OUTSIDE the React tree.
//
// Why not just useState in <ChatPanel>? Two reasons the user asked for:
//   1. 保存 — history must survive leaving and returning to the page. We mirror
//      every change into localStorage and rehydrate on first access.
//   2. 异步 — a generation must keep running when the user navigates to another
//      page and come back to a finished answer. Because the streaming loop is
//      kicked off from this module (not from a component effect), unmounting
//      <ChatPanel> during a client-side navigation does NOT abort the fetch; the
//      session keeps receiving deltas and the answer is there when they return.
//
// Components read the session via useSyncExternalStore: `state` is replaced
// (new identity) on every change so snapshots stay correct, and listeners are
// notified to re-render whoever is currently mounted (possibly nobody).

import { streamChat } from './streamChat';

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatState {
  messages: ChatMsg[];
  pending: boolean;
  error: string | null;
}

interface Session {
  slug: string;
  state: ChatState;
  listeners: Set<() => void>;
  controller: AbortController | null;
}

const STORAGE_PREFIX = 'skill-chat:';
const sessions = new Map<string, Session>();

function storageKey(slug: string) {
  return `${STORAGE_PREFIX}${slug}`;
}

function loadFromStorage(slug: string): ChatMsg[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is ChatMsg =>
        m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
    );
  } catch {
    return [];
  }
}

function persist(session: Session) {
  if (typeof window === 'undefined') return;
  try {
    if (session.state.messages.length === 0) {
      window.localStorage.removeItem(storageKey(session.slug));
    } else {
      window.localStorage.setItem(storageKey(session.slug), JSON.stringify(session.state.messages));
    }
  } catch {
    /* quota / private-mode — non-fatal, in-memory state still works */
  }
}

function getSession(slug: string): Session {
  let session = sessions.get(slug);
  if (!session) {
    session = {
      slug,
      state: { messages: loadFromStorage(slug), pending: false, error: null },
      listeners: new Set(),
      controller: null,
    };
    sessions.set(slug, session);
  }
  return session;
}

function setState(session: Session, patch: Partial<ChatState>) {
  session.state = { ...session.state, ...patch };
  persist(session);
  session.listeners.forEach((l) => l());
}

export function subscribe(slug: string, listener: () => void): () => void {
  const session = getSession(slug);
  session.listeners.add(listener);
  return () => {
    session.listeners.delete(listener);
  };
}

export function getState(slug: string): ChatState {
  return getSession(slug).state;
}

export function clearChat(slug: string) {
  const session = getSession(slug);
  session.controller?.abort();
  session.controller = null;
  setState(session, { messages: [], pending: false, error: null });
}

export async function sendMessage(slug: string, text: string, endpoint: string) {
  const session = getSession(slug);
  const trimmed = text.trim();
  if (!trimmed || session.state.pending) return;

  const history: ChatMsg[] = [...session.state.messages, { role: 'user', content: trimmed }];
  setState(session, {
    messages: [...history, { role: 'assistant', content: '' }],
    pending: true,
    error: null,
  });

  const controller = new AbortController();
  session.controller = controller;

  // Append a delta to the trailing assistant message immutably.
  const applyDelta = (delta: string) => {
    const msgs = session.state.messages.slice();
    const last = msgs[msgs.length - 1];
    if (!last || last.role !== 'assistant') return;
    msgs[msgs.length - 1] = { role: 'assistant', content: last.content + delta };
    setState(session, { messages: msgs });
  };

  // Drop a still-empty assistant placeholder so a failed turn doesn't leave a
  // blank bubble behind.
  const dropEmptyPlaceholder = (msgs: ChatMsg[]): ChatMsg[] => {
    const last = msgs[msgs.length - 1];
    return last && last.role === 'assistant' && !last.content ? msgs.slice(0, -1) : msgs;
  };

  try {
    const result = await streamChat(endpoint, { messages: history }, applyDelta, controller.signal);
    if (!result.ok) {
      setState(session, {
        error: result.error ?? '请求失败',
        messages: dropEmptyPlaceholder(session.state.messages),
        pending: false,
      });
      return;
    }
    setState(session, { pending: false });
  } catch (e) {
    // An explicit clear aborts the fetch; that's not an error worth surfacing.
    if (controller.signal.aborted) return;
    setState(session, {
      error: e instanceof Error ? e.message : '未知错误',
      messages: dropEmptyPlaceholder(session.state.messages),
      pending: false,
    });
  } finally {
    if (session.controller === controller) session.controller = null;
  }
}
