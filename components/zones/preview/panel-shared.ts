// Reading-panel decisions that are pure (plain module — no React, no window;
// the one "element" it sees is duck-typed), unit-tested in
// tests/zones-panel-shared.test.ts. The provider, DockShell's hooks and
// FilePreview consume them so the same rule is never spelled out twice.

import { NAV_BAR_HEIGHT_PX } from '@/lib/nav-chrome';
import type { ZonePreviewStatusView } from '@/lib/zones/types';

/**
 * px the docked aside reserves for the navbar. The dock HOLDS the bar visible,
 * but a hidden hold always wins (the composer keeps its own 48 px bar), so the
 * offset follows the bar's RESOLVED state — never the assumption that the hold
 * prevailed. 0 in expand / maximize (the bar is held hidden there anyway).
 */
export function dockTopOffset(input: { expanded: boolean; maximized: boolean; navVisible: boolean }): number {
  if (input.expanded || input.maximized || !input.navVisible) return 0;
  return NAV_BAR_HEIGHT_PX;
}

/**
 * The sash is a zero-width SIBLING of the aside (DockShell), so `aside.contains`
 * misses it — yet it wears the keyboard hint (Esc · F · ↑↓). It counts as inside.
 */
export function isDockSash(el: { getAttribute(name: string): string | null } | null | undefined, dockId: string): boolean {
  return !!el && el.getAttribute('role') === 'separator' && el.getAttribute('aria-controls') === dockId;
}

export type OfficeNoteKey =
  | 'panel_preview_after_save'
  | 'attach_preview_pending_note'
  | 'attach_preview_failed_note'
  | 'attach_preview_unsupported_note'
  | 'attach_preview_none_note';

/**
 * Whether the office rendition endpoint may be asked at all: only a SAVED row
 * (non-empty id) has `/attachments/<id>/preview`. A composer draft previewed
 * before its first save synthesises `id: ''` — building the URL from that hits
 * `/attachments//preview` (a redirect into a 404) and a 重新生成 that always fails.
 */
export function officePreviewPlan(office: boolean, id: string, previewStatus: ZonePreviewStatusView): { saved: boolean; wantsFetch: boolean } {
  const saved = id.length > 0;
  return { saved, wantsFetch: office && saved && previewStatus !== 'ready' };
}

/** The download card's note under an office file, by conversion state. */
export function officeNoteKey(status: ZonePreviewStatusView | null, saved: boolean): OfficeNoteKey {
  if (!saved) return 'panel_preview_after_save';
  if (status === 'pending') return 'attach_preview_pending_note';
  if (status === 'failed') return 'attach_preview_failed_note';
  if (status === 'unsupported') return 'attach_preview_unsupported_note';
  return 'attach_preview_none_note';
}

/** 重新生成 is offered only where a POST can succeed: a saved row whose conversion failed or never ran. */
export function officeCanRetry(status: ZonePreviewStatusView | null, saved: boolean): boolean {
  return saved && (status === 'failed' || status === 'none');
}

/** The conversion is polled only for a saved, still-pending row (and never past the round cap). */
export function officeShouldPoll(input: { saved: boolean; status: ZonePreviewStatusView | null; ready: boolean; loading: boolean; polls: number; max: number }): boolean {
  return input.saved && !input.ready && !input.loading && input.status === 'pending' && input.polls < input.max;
}
