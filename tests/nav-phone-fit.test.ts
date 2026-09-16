// @vitest-environment jsdom
//
// ED-21: on a 390 px phone the navbar's action cluster overflowed, Chrome widened
// the LAYOUT viewport to 415 px, and everything positioned against it slid off
// the glass — the editor's colour panel lost its last swatch column and the
// 字号 / 字体 menus their last rows, the 讨论区 file drawer's ✕ sat at 367–399 px.
// Two fixes, pinned here:
//
//   1. useAnchoredPanel clamps to the VISIBLE viewport (window.visualViewport),
//      so a popover can never extend past what the reader sees even when
//      something else on the page overflows (pure `anchoredPosition` + the
//      `visibleViewport` reader).
//   2. The navbar hides 主题 / 语言 below `sm` (that is what makes the row fit —
//      checked live in headless Chrome at 390 and 360 px, which jsdom cannot
//      lay out), so the 收纳 menu must carry both on a phone — or the phone
//      loses the theme switch and the language switch altogether.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anchoredPosition, visibleViewport } from '@/components/useAnchoredPanel';
import { NavMoreMenu } from '@/components/NavMoreMenu';
import { ThemeProvider } from '@/components/ThemeProvider';
import { STASHED_NAV } from '@/components/nav-items';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), pathname: '/zones' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: nav.refresh, back: () => {}, prefetch: () => {} }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const messages = JSON.parse(readFileSync(resolve(__dirname, '../messages/zh-CN.json'), 'utf8')) as Record<string, Record<string, string>>;

describe('anchoredPosition — clamps to the visible viewport', () => {
  // An editor toolbar panel (the colour palette): 264 px wide, left-aligned to a trigger near the right edge.
  const trigger = { left: 300, right: 336, top: 200, bottom: 236 };

  it('a 390 px phone whose layout viewport grew to 415 px: the panel ends inside 390', () => {
    const pos = anchoredPosition({ trigger, width: 264, height: 348, align: 'left', viewport: { left: 0, top: 0, width: 390, height: 844 } });
    expect(pos).not.toBeNull();
    expect(pos!.left + 264).toBeLessThanOrEqual(390 - 8);
    // What clamping to innerWidth (415) produced — 17 px past the glass.
    const layout = anchoredPosition({ trigger, width: 264, height: 348, align: 'left', viewport: { left: 0, top: 0, width: 415, height: 844 } });
    expect(layout!.left + 264).toBe(407);
  });

  it('pinch-zoomed: the panel stays inside the zoomed-in box, not the page', () => {
    const viewport = { left: 120, top: 300, width: 195, height: 422 };
    const pos = anchoredPosition({ trigger: { left: 280, right: 300, top: 400, bottom: 420 }, width: 150, height: 120, align: 'left', viewport })!;
    expect(pos.left).toBeGreaterThanOrEqual(viewport.left + 8);
    expect(pos.left + 150).toBeLessThanOrEqual(viewport.left + viewport.width - 8);
    // A trigger left of the zoomed box still pins the panel to the box's left edge.
    const leftOf = anchoredPosition({ trigger: { left: 10, right: 40, top: 400, bottom: 420 }, width: 150, height: 120, align: 'left', viewport })!;
    expect(leftOf.left).toBe(viewport.left + 8);
  });

  it('flips above when the visible box has no room below (on-screen keyboard up), and closes once the trigger leaves it', () => {
    const kb = { left: 0, top: 0, width: 390, height: 420 };
    const pos = anchoredPosition({ trigger: { left: 20, right: 60, top: 360, bottom: 396 }, width: 264, height: 210, align: 'left', viewport: kb })!;
    expect(pos.up).toBe(true);
    expect(pos.top).toBeGreaterThanOrEqual(8);
    expect(anchoredPosition({ trigger: { left: 20, right: 60, top: 500, bottom: 536 }, width: 264, height: 210, align: 'left', viewport: kb })).toBeNull();
  });

  it('a right-aligned menu wider than the space left of its trigger still starts on screen', () => {
    const pos = anchoredPosition({ trigger: { left: 30, right: 66, top: 10, bottom: 46 }, width: 232, height: 300, align: 'right', viewport: { left: 0, top: 0, width: 390, height: 844 } })!;
    expect(pos.left).toBe(8);
  });

  it('visibleViewport reads window.visualViewport (not innerWidth) when the browser has one', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { offsetLeft: 0, offsetTop: 0, width: 390, height: 844, addEventListener() {}, removeEventListener() {} },
    });
    try {
      expect(window.innerWidth).not.toBe(390);
      expect(visibleViewport()).toEqual({ left: 0, top: 0, width: 390, height: 844 });
    } finally {
      if (original) Object.defineProperty(window, 'visualViewport', original);
      else delete (window as { visualViewport?: unknown }).visualViewport;
    }
  });
});

// A cold transform of the menu's import graph (framer-motion, next-intl) can
// exceed the 5 s default on a busy machine.
describe('收纳 menu — carries 主题 and 语言 on a phone', { timeout: 30_000 }, () => {
  let phone = true;
  let mounted: { root: Root; host: HTMLElement } | null = null;

  beforeEach(() => {
    phone = true;
    nav.refresh.mockClear();
    document.cookie = 'locale=; path=/; max-age=0';
    window.matchMedia = ((query: string) => ({
      matches: query === '(max-width: 639.98px)' ? phone : false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    if (mounted) {
      const m = mounted;
      act(() => m.root.unmount());
      m.host.remove();
      mounted = null;
    }
    document.documentElement.removeAttribute('data-theme');
    window.localStorage.clear();
  });

  async function openMenu() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted = { root, host };
    await act(async () => {
      root.render(
        createElement(
          ThemeProvider,
          null,
          createElement(NextIntlClientProvider, { locale: 'zh-CN', messages, children: createElement(NavMoreMenu, { items: STASHED_NAV }) }),
        ),
      );
    });
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    await act(async () => {
      trigger.click();
    });
    // BubblePanel moves focus in on the next animation frame.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    return document.body.querySelector<HTMLElement>('[role="menu"]');
  }

  it('phone: a theme row and the three languages, current one checked; focus still lands on the navigation', async () => {
    const menu = await openMenu();
    expect(menu).not.toBeNull();
    const themeRow = [...menu!.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent === messages.nav.theme_dark);
    expect(themeRow, 'no 深色模式 row').toBeDefined();
    const radios = [...menu!.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(['中文', 'English', 'Français']);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    // The checked 中文 pill must not pull focus to the bottom of a navigation menu.
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
    expect(document.activeElement?.hasAttribute('data-bubble-aux')).toBe(false);
  });

  it('phone: the theme row switches the theme and says what the next press does', async () => {
    const menu = await openMenu();
    const row = () => [...menu!.querySelectorAll<HTMLElement>('[role="menuitem"][data-bubble-aux]')][0];
    await act(async () => {
      row().click();
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(row().textContent).toBe(messages.nav.theme_light);
  });

  it('phone: a language pill writes the locale cookie and refreshes', async () => {
    const menu = await openMenu();
    const en = [...menu!.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((r) => r.getAttribute('aria-label') === 'English')!;
    await act(async () => {
      en.click();
    });
    expect(document.cookie).toContain('locale=en');
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it('desktop: neither row is there — the navbar shows both buttons itself', async () => {
    phone = false;
    const menu = await openMenu();
    expect(menu).not.toBeNull();
    expect(menu!.querySelectorAll('[role="menuitemradio"]').length).toBe(0);
    expect(menu!.querySelector('[data-bubble-aux]')).toBeNull();
  });
});
