'use client';

// The viewer's subtitle preferences (mode + style), persisted per browser.
// SSR and the first client render use the defaults (so hydration matches); the
// stored values are read in an effect right after mount. Every read goes through
// the sanitizers in lib/video/subtitle-style.ts, every storage access is wrapped
// (private windows and blocked site data throw), and two players on one page —
// or a second tab — stay in step through the `storage` event.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_SUBTITLE_STYLE,
  SUBTITLE_MODE_STORAGE_KEY,
  SUBTITLE_STYLE_STORAGE_KEY,
  defaultSubtitleMode,
  parseSubtitleMode,
  parseSubtitleStyle,
  parseSubtitleStyleJson,
  type SubtitleMode,
  type SubtitleStyle,
} from '@/lib/video/subtitle-style';

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — the preference simply lasts for this page */
  }
}

export interface SubtitlePrefs {
  /** What the viewer ASKED for; resolve it against the tracks a video has with resolveSubtitleMode. */
  mode: SubtitleMode;
  setMode: (mode: SubtitleMode) => void;
  style: SubtitleStyle;
  /** Apply a partial change. `persist: false` is for live drags — call again with true (or commit()) on release. */
  patchStyle: (patch: Partial<SubtitleStyle>, persist?: boolean) => void;
  /** Write the current style to storage (after a drag). */
  commitStyle: () => void;
  resetStyle: () => void;
  /** False until the stored preferences have been read (avoid flashing the default mode's cue on mount). */
  ready: boolean;
}

export function useSubtitlePrefs(locale: string): SubtitlePrefs {
  const [mode, setModeState] = useState<SubtitleMode>('off');
  const [style, setStyle] = useState<SubtitleStyle>(DEFAULT_SUBTITLE_STYLE);
  const [ready, setReady] = useState(false);
  const styleRef = useRef(style);
  styleRef.current = style;

  useEffect(() => {
    setModeState(parseSubtitleMode(readStorage(SUBTITLE_MODE_STORAGE_KEY)) ?? defaultSubtitleMode(locale));
    setStyle(parseSubtitleStyleJson(readStorage(SUBTITLE_STYLE_STORAGE_KEY)));
    setReady(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === SUBTITLE_MODE_STORAGE_KEY) {
        setModeState(parseSubtitleMode(e.newValue) ?? defaultSubtitleMode(locale));
      } else if (e.key === SUBTITLE_STYLE_STORAGE_KEY) {
        setStyle(parseSubtitleStyleJson(e.newValue));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [locale]);

  const setMode = useCallback((next: SubtitleMode) => {
    setModeState(next);
    writeStorage(SUBTITLE_MODE_STORAGE_KEY, next);
  }, []);

  const patchStyle = useCallback((patch: Partial<SubtitleStyle>, persist = true) => {
    const next = parseSubtitleStyle({ ...styleRef.current, ...patch });
    styleRef.current = next;
    setStyle(next);
    if (persist) writeStorage(SUBTITLE_STYLE_STORAGE_KEY, JSON.stringify(next));
  }, []);

  const commitStyle = useCallback(() => {
    writeStorage(SUBTITLE_STYLE_STORAGE_KEY, JSON.stringify(styleRef.current));
  }, []);

  const resetStyle = useCallback(() => {
    styleRef.current = DEFAULT_SUBTITLE_STYLE;
    setStyle(DEFAULT_SUBTITLE_STYLE);
    writeStorage(SUBTITLE_STYLE_STORAGE_KEY, null);
  }, []);

  return { mode, setMode, style, patchStyle, commitStyle, resetStyle, ready };
}
