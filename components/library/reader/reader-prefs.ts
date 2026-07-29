'use client';

import { useCallback, useSyncExternalStore } from 'react';

export type ReaderTheme = 'auto' | 'light' | 'sepia' | 'dark';
export type ReaderWidth = 'narrow' | 'normal' | 'wide';
export type ReaderLineHeight = 1.5 | 1.75 | 2;

export interface ReaderPrefs {
  fontSize: number; // 15..24 px
  serif: boolean;
  lineHeight: ReaderLineHeight;
  theme: ReaderTheme;
  width: ReaderWidth;
}

export const DEFAULT_READER_PREFS: ReaderPrefs = {
  fontSize: 17,
  serif: false,
  lineHeight: 1.75,
  theme: 'auto',
  width: 'normal',
};

export const READER_WIDTHS: Record<ReaderWidth, string> = {
  narrow: '580px',
  normal: '680px',
  wide: '800px',
};

export const MIN_FONT_SIZE = 15;
export const MAX_FONT_SIZE = 24;

const STORAGE_KEY = 'library:reader-prefs';

const listeners = new Set<() => void>();
let cached: ReaderPrefs | null = null;

function sanitize(raw: unknown): ReaderPrefs {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<ReaderPrefs>;
  const fontSize =
    typeof p.fontSize === 'number' && Number.isFinite(p.fontSize)
      ? Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(p.fontSize)))
      : DEFAULT_READER_PREFS.fontSize;
  const lineHeight: ReaderLineHeight =
    p.lineHeight === 1.5 || p.lineHeight === 1.75 || p.lineHeight === 2
      ? p.lineHeight
      : DEFAULT_READER_PREFS.lineHeight;
  const theme: ReaderTheme =
    p.theme === 'light' || p.theme === 'sepia' || p.theme === 'dark' ? p.theme : 'auto';
  const width: ReaderWidth = p.width === 'narrow' || p.width === 'wide' ? p.width : 'normal';
  return { fontSize, serif: p.serif === true, lineHeight, theme, width };
}

function load(): ReaderPrefs {
  if (cached) return cached;
  if (typeof window === 'undefined') return DEFAULT_READER_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    cached = sanitize(raw ? JSON.parse(raw) : null);
  } catch {
    cached = { ...DEFAULT_READER_PREFS };
  }
  return cached;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): ReaderPrefs {
  return load();
}

function getServerSnapshot(): ReaderPrefs {
  return DEFAULT_READER_PREFS;
}

export function updateReaderPrefs(patch: Partial<ReaderPrefs>): void {
  cached = sanitize({ ...load(), ...patch });
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    /* private mode / quota — prefs stay session-local */
  }
  listeners.forEach((l) => l());
}

/** Typography prefs persisted in localStorage, shared by every reader instance. */
export function useReaderPrefs(): [ReaderPrefs, (patch: Partial<ReaderPrefs>) => void] {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const update = useCallback((patch: Partial<ReaderPrefs>) => updateReaderPrefs(patch), []);
  return [prefs, update];
}
