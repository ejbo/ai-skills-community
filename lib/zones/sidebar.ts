// 版块主页布局 (`Zone.sidebar`) — the pure contract, import-free and client-safe.
//
// A 版主 decides which right-rail modules their board shows, in what order, and
// can add their own cards (title + markdown) between them — 贴吧's 吧务自定义
// 版块. The RENDERER (app/zones/_components/ZoneSidebar.tsx) walks `order`,
// skips `hidden`, and looks custom ids up in `custom`; the EDITOR (版块设置 →
// 主页布局) round-trips the same object. Both go through `parseSidebarLayout`,
// which is the single sanitizer: unknown ids are dropped, missing built-ins
// are appended in default order (so a module added in a later release can
// never vanish from an already-customised board), and custom cards are capped.
//
// Stored shape (JSON):
//   { order: string[], hidden: string[], custom: [{ id, title, bodyMd }] }
// `{}` (the column default) ⇒ DEFAULT_SIDEBAR_ORDER with nothing hidden.

export const SIDEBAR_BUILTIN_MODULES = ['about', 'pulse', 'rules', 'members', 'moderators', 'links'] as const;
export type SidebarBuiltinModule = (typeof SIDEBAR_BUILTIN_MODULES)[number];

/** Custom card ids are `custom:<token>`; the token is client-generated and only unique per zone. */
export const CUSTOM_MODULE_PREFIX = 'custom:';
const CUSTOM_ID_RE = /^custom:[a-z0-9]{4,24}$/;

export const MAX_SIDEBAR_CUSTOM_CARDS = 6;
export const SIDEBAR_CARD_TITLE_MAX = 40;
export const SIDEBAR_CARD_BODY_MAX = 4_000;

/** The fixed order every board had before layouts existed — and still the default. */
export const DEFAULT_SIDEBAR_ORDER: readonly SidebarBuiltinModule[] = SIDEBAR_BUILTIN_MODULES;

/** Modules the layout cannot hide — a board always says who runs it. */
export const SIDEBAR_REQUIRED_MODULES: readonly SidebarBuiltinModule[] = ['about'];

export interface SidebarCustomCard {
  id: string;
  title: string;
  bodyMd: string;
}

export interface ZoneSidebarLayout {
  /** Module ids in display order: built-ins and `custom:<id>`. Always complete. */
  order: string[];
  /** Built-in ids the 版主 switched off (never a required one, never a custom id — those are just removed). */
  hidden: string[];
  custom: SidebarCustomCard[];
}

export function isCustomModuleId(id: string): boolean {
  return CUSTOM_ID_RE.test(id);
}

export function isBuiltinModule(id: string): id is SidebarBuiltinModule {
  return (SIDEBAR_BUILTIN_MODULES as readonly string[]).includes(id);
}

export function defaultSidebarLayout(): ZoneSidebarLayout {
  return { order: [...DEFAULT_SIDEBAR_ORDER], hidden: [], custom: [] };
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * Parse anything (the stored JSON, a PATCH body, `{}`) into a complete, valid
 * layout. Never throws — garbage degrades to the default.
 */
export function parseSidebarLayout(raw: unknown): ZoneSidebarLayout {
  const base = defaultSidebarLayout();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;

  const custom: SidebarCustomCard[] = [];
  const customIds = new Set<string>();
  if (Array.isArray(o.custom)) {
    for (const c of o.custom) {
      if (!c || typeof c !== 'object') continue;
      const card = c as Record<string, unknown>;
      const id = typeof card.id === 'string' ? card.id : '';
      const title = str(card.title, SIDEBAR_CARD_TITLE_MAX);
      const bodyMd = str(card.bodyMd, SIDEBAR_CARD_BODY_MAX);
      if (!isCustomModuleId(id) || customIds.has(id) || (!title && !bodyMd)) continue;
      customIds.add(id);
      custom.push({ id, title, bodyMd });
      if (custom.length >= MAX_SIDEBAR_CUSTOM_CARDS) break;
    }
  }

  const order: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(o.order)) {
    for (const id of o.order) {
      if (typeof id !== 'string' || seen.has(id)) continue;
      if (isBuiltinModule(id) || customIds.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
  }
  // Every built-in and every custom card ends up in `order` exactly once.
  for (const id of DEFAULT_SIDEBAR_ORDER) if (!seen.has(id)) { seen.add(id); order.push(id); }
  for (const c of custom) if (!seen.has(c.id)) { seen.add(c.id); order.push(c.id); }

  const hidden: string[] = [];
  if (Array.isArray(o.hidden)) {
    for (const id of o.hidden) {
      if (typeof id !== 'string' || !isBuiltinModule(id) || hidden.includes(id)) continue;
      if ((SIDEBAR_REQUIRED_MODULES as readonly string[]).includes(id)) continue;
      hidden.push(id);
    }
  }
  return { order, hidden, custom };
}

/** True when the layout is exactly the default (so the editor can offer 恢复默认 meaningfully). */
export function isDefaultSidebarLayout(layout: ZoneSidebarLayout): boolean {
  return (
    layout.hidden.length === 0 &&
    layout.custom.length === 0 &&
    layout.order.length === DEFAULT_SIDEBAR_ORDER.length &&
    layout.order.every((id, i) => id === DEFAULT_SIDEBAR_ORDER[i])
  );
}

/** What the renderer walks: visible module ids in order, custom cards resolved. */
export function visibleSidebarModules(layout: ZoneSidebarLayout): Array<
  { kind: 'builtin'; id: SidebarBuiltinModule } | { kind: 'custom'; card: SidebarCustomCard }
> {
  const hidden = new Set(layout.hidden);
  const cards = new Map(layout.custom.map((c) => [c.id, c]));
  const out: Array<{ kind: 'builtin'; id: SidebarBuiltinModule } | { kind: 'custom'; card: SidebarCustomCard }> = [];
  for (const id of layout.order) {
    if (isBuiltinModule(id)) {
      if (!hidden.has(id)) out.push({ kind: 'builtin', id });
    } else {
      const card = cards.get(id);
      if (card) out.push({ kind: 'custom', card });
    }
  }
  return out;
}
