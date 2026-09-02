// 技术专区 — pure paging state for the members directory (plain module, no
// React; unit-tested in tests/zones-members-paging.test.ts). The client
// component only dispatches through these helpers.
//
// The one rule: `loaded` counts rows the SERVER has handed over (page 1 plus
// every append) and is the next `skip`. It is deliberately NOT `items.length`:
// 添加成员 prepends a row the server sorts elsewhere (by role, then joinedAt —
// usually last) and a removal deletes a row the server no longer has. Using the
// list length as the offset skipped one member per add and then never finished
// — the button kept fetching empty pages while `items.length < total` stayed
// true. Local edits therefore move `loaded` only when they change what the
// server has BEFORE the offset; when in doubt they leave it short, which at
// worst re-sends a row the dedupe drops — never skips one.

export interface MembersPageState<T> {
  items: T[];
  /** Server rows received so far — the next `skip`. */
  loaded: number;
  /** An append came back empty: nothing past `loaded`, whatever a stale total says. */
  exhausted: boolean;
  /** At least one page was appended — appended rows never get an entrance stagger (§11: page appends do not animate). */
  appended: boolean;
}

export function initialMembersPage<T>(items: T[]): MembersPageState<T> {
  return { items, loaded: items.length, exhausted: false, appended: false };
}

/** 加载更多 answered: append the unseen rows, advance the offset by what the server sent. */
export function appendMembersPage<T extends { id: string }>(state: MembersPageState<T>, page: readonly T[]): MembersPageState<T> {
  const seen = new Set(state.items.map((m) => m.id));
  const fresh = page.filter((m) => !seen.has(m.id));
  return {
    items: fresh.length > 0 ? [...state.items, ...fresh] : state.items,
    loaded: state.loaded + page.length,
    exhausted: page.length === 0,
    appended: state.appended || page.length > 0,
  };
}

/** A row changed in place (re-role, title, approve on the 全部 tab): same offset. */
export function replaceMember<T extends { id: string }>(state: MembersPageState<T>, next: T): MembersPageState<T> {
  return { ...state, items: state.items.map((m) => (m.id === next.id ? next : m)) };
}

/**
 * 添加成员 on the active tab: the row lands on top locally (the server sorts it
 * by role / joinedAt); a re-roled existing member keeps a single row. `loaded`
 * stays — the server list grew, but where is unknown; a following page may
 * re-send this row, which the dedupe drops.
 */
export function prependMember<T extends { userId: string }>(state: MembersPageState<T>, member: T): MembersPageState<T> {
  return { ...state, items: [member, ...state.items.filter((m) => m.userId !== member.userId)] };
}

/**
 * A row left this list (removed; approved off the 待审核 tab; a pending request
 * resolved by 添加成员): the server list shrank by one row that sat before the
 * offset, so the offset steps back with it. Unknown rows are a no-op.
 */
export function dropMember<T extends { userId: string }>(state: MembersPageState<T>, userId: string): MembersPageState<T> {
  if (!state.items.some((m) => m.userId === userId)) return state;
  return { ...state, items: state.items.filter((m) => m.userId !== userId), loaded: Math.max(0, state.loaded - 1) };
}

/** Whether 加载更多 should be offered for a server total of `listed`. */
export function canLoadMoreMembers<T>(state: MembersPageState<T>, listed: number): boolean {
  return !state.exhausted && state.loaded < listed;
}
