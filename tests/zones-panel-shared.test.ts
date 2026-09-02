import { describe, expect, it } from 'vitest';
import { NAV_BAR_HEIGHT_PX } from '@/lib/nav-chrome';
import {
  dockTopOffset,
  isDockSash,
  officeCanRetry,
  officeNoteKey,
  officePreviewPlan,
  officeShouldPoll,
} from '@/components/zones/preview/panel-shared';

describe('dockTopOffset', () => {
  it('reserves the navbar strip only while the bar is really on screen', () => {
    expect(dockTopOffset({ expanded: false, maximized: false, navVisible: true })).toBe(NAV_BAR_HEIGHT_PX);
    // The composer holds the bar hidden (a hidden hold beats the dock's visible hold): no strip.
    expect(dockTopOffset({ expanded: false, maximized: false, navVisible: false })).toBe(0);
  });
  it('is zero in expand and maximize regardless of the bar', () => {
    expect(dockTopOffset({ expanded: true, maximized: false, navVisible: true })).toBe(0);
    expect(dockTopOffset({ expanded: false, maximized: true, navVisible: true })).toBe(0);
  });
});

describe('isDockSash', () => {
  const el = (attrs: Record<string, string>) => ({ getAttribute: (n: string) => attrs[n] ?? null });
  it('recognises the separator that controls the dock', () => {
    expect(isDockSash(el({ role: 'separator', 'aria-controls': 'zones-preview-dock' }), 'zones-preview-dock')).toBe(true);
  });
  it('ignores openers that merely control the dock, other separators, and nothing', () => {
    expect(isDockSash(el({ 'aria-controls': 'zones-preview-dock' }), 'zones-preview-dock')).toBe(false);
    expect(isDockSash(el({ role: 'separator', 'aria-controls': 'other' }), 'zones-preview-dock')).toBe(false);
    expect(isDockSash(el({ role: 'separator' }), 'zones-preview-dock')).toBe(false);
    expect(isDockSash(null, 'zones-preview-dock')).toBe(false);
    expect(isDockSash(undefined, 'zones-preview-dock')).toBe(false);
  });
});

describe('officePreviewPlan', () => {
  it('never asks the endpoint for an unsaved draft (no row, no id)', () => {
    expect(officePreviewPlan(true, '', 'none')).toEqual({ saved: false, wantsFetch: false });
    expect(officePreviewPlan(true, '', 'pending')).toEqual({ saved: false, wantsFetch: false });
  });
  it('asks for a saved office row until it is ready', () => {
    expect(officePreviewPlan(true, 'att1', 'none')).toEqual({ saved: true, wantsFetch: true });
    expect(officePreviewPlan(true, 'att1', 'pending')).toEqual({ saved: true, wantsFetch: true });
    expect(officePreviewPlan(true, 'att1', 'ready')).toEqual({ saved: true, wantsFetch: false });
  });
  it('is inert for non-office files', () => {
    expect(officePreviewPlan(false, 'att1', 'none')).toEqual({ saved: true, wantsFetch: false });
  });
});

describe('officeNoteKey / officeCanRetry / officeShouldPoll', () => {
  it('tells an author to save first instead of offering a retry that cannot succeed', () => {
    expect(officeNoteKey('none', false)).toBe('panel_preview_after_save');
    expect(officeNoteKey('failed', false)).toBe('panel_preview_after_save');
    expect(officeCanRetry('none', false)).toBe(false);
    expect(officeCanRetry('failed', false)).toBe(false);
    expect(officeShouldPoll({ saved: false, status: 'pending', ready: false, loading: false, polls: 0, max: 24 })).toBe(false);
  });
  it('maps the conversion states of a saved row', () => {
    expect(officeNoteKey('pending', true)).toBe('attach_preview_pending_note');
    expect(officeNoteKey('failed', true)).toBe('attach_preview_failed_note');
    expect(officeNoteKey('unsupported', true)).toBe('attach_preview_unsupported_note');
    expect(officeNoteKey('none', true)).toBe('attach_preview_none_note');
    expect(officeNoteKey(null, true)).toBe('attach_preview_none_note');
    expect(officeCanRetry('failed', true)).toBe(true);
    expect(officeCanRetry('none', true)).toBe(true);
    expect(officeCanRetry('pending', true)).toBe(false);
    expect(officeCanRetry('unsupported', true)).toBe(false);
    expect(officeCanRetry('ready', true)).toBe(false);
  });
  it('polls only a saved, pending, not-yet-ready row under the round cap', () => {
    const base = { saved: true, status: 'pending' as const, ready: false, loading: false, polls: 0, max: 24 };
    expect(officeShouldPoll(base)).toBe(true);
    expect(officeShouldPoll({ ...base, ready: true })).toBe(false);
    expect(officeShouldPoll({ ...base, loading: true })).toBe(false);
    expect(officeShouldPoll({ ...base, status: 'failed' })).toBe(false);
    expect(officeShouldPoll({ ...base, polls: 24 })).toBe(false);
  });
});
