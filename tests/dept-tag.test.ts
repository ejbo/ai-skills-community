// @vitest-environment jsdom
//
// Interaction contract of the 部门 pill: the tooltip is a body portal that only
// appears when the label is actually ellipsized, after a short hover delay
// (mouse) or on tap (touch), and goes away on leave / outside tap / scroll /
// unmount. jsdom has no layout, so truncation is simulated by shadowing
// scrollWidth/clientWidth on the label element.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DeptTag } from '@/components/DeptTag';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LONG = 'ICT BG-计算产品线-昇腾计算业务部-昇腾软件开发部';
const SHOW_DELAY_MS = 120;

let container: HTMLDivElement;
let root: Root | null = null;

function mount(props: Parameters<typeof DeptTag>[0]) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(DeptTag, props));
  });
}

const pill = () => container.querySelector('span.rounded-full') as HTMLSpanElement;
const label = () => pill().lastElementChild as HTMLSpanElement;
const tooltip = () => document.querySelector('[role="tooltip"]') as HTMLSpanElement | null;

function setTruncated(truncated: boolean) {
  const el = label();
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: truncated ? 320 : 100 });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 100 });
}

function setPillRect(rect: Partial<DOMRect>) {
  pill().getBoundingClientRect = () =>
    ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {}, ...rect }) as DOMRect;
}

function fire(el: EventTarget, type: string, init: PointerEventInit = {}) {
  act(() => {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, ...init }));
  });
}

// React derives onPointerEnter/Leave from pointerover/pointerout + relatedTarget.
const hoverIn = (pointerType = 'mouse') =>
  fire(pill(), 'pointerover', { pointerType, relatedTarget: null });
const hoverOut = (pointerType = 'mouse') =>
  fire(pill(), 'pointerout', { pointerType, relatedTarget: document.body });
const elapse = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  vi.useRealTimers();
});

describe('DeptTag tooltip', () => {
  it('shows the full text after the hover delay when the label is ellipsized, hides on leave', () => {
    mount({ department: LONG, lab: '推理框架实验室' });
    setTruncated(true);
    hoverIn();
    expect(tooltip()).toBeNull(); // not before the delay
    elapse(SHOW_DELAY_MS - 1);
    expect(tooltip()).toBeNull();
    elapse(1);
    const tip = tooltip();
    expect(tip).not.toBeNull();
    expect(tip!.textContent).toBe(`${LONG} · 推理框架实验室`);
    expect(tip!.parentElement).toBe(document.body); // portaled, never inside the row
    expect(tip!.className).toContain('fixed');
    hoverOut();
    expect(tooltip()).toBeNull();
  });

  it('never shows when nothing is hidden, or when the pill is `full`', () => {
    mount({ department: '计算产品线' });
    setTruncated(false);
    hoverIn();
    elapse(SHOW_DELAY_MS + 10);
    expect(tooltip()).toBeNull();
    act(() => root!.unmount());
    container.remove();

    mount({ department: LONG, full: true });
    setTruncated(true);
    hoverIn();
    elapse(SHOW_DELAY_MS + 10);
    expect(tooltip()).toBeNull();
    fire(pill(), 'pointerdown', { pointerType: 'touch' });
    expect(tooltip()).toBeNull();
  });

  it('leaving before the delay cancels the pending show', () => {
    mount({ department: LONG });
    setTruncated(true);
    hoverIn();
    elapse(SHOW_DELAY_MS / 2);
    hoverOut();
    elapse(SHOW_DELAY_MS * 2);
    expect(tooltip()).toBeNull();
  });

  it('touch: tap toggles immediately, a tap elsewhere dismisses', () => {
    mount({ department: LONG });
    setTruncated(true);
    hoverIn('touch'); // touch hover must not schedule anything
    elapse(SHOW_DELAY_MS + 10);
    expect(tooltip()).toBeNull();

    fire(pill(), 'pointerdown', { pointerType: 'touch' });
    expect(tooltip()).not.toBeNull();
    // Browsers fire pointerout/leave for the transient touch pointer right after the
    // tap's pointerup — that must NOT close what the tap just opened.
    hoverOut('touch');
    expect(tooltip()).not.toBeNull();
    fire(pill(), 'pointerdown', { pointerType: 'touch' });
    expect(tooltip()).toBeNull();

    fire(pill(), 'pointerdown', { pointerType: 'touch' });
    expect(tooltip()).not.toBeNull();
    fire(document.body, 'pointerdown', { pointerType: 'touch' });
    expect(tooltip()).toBeNull();
  });

  it('does not swallow the pointerdown (card links keep navigating) and hides on mouse click', () => {
    mount({ department: LONG });
    setTruncated(true);
    hoverIn();
    elapse(SHOW_DELAY_MS);
    expect(tooltip()).not.toBeNull();
    const seenByAncestor = vi.fn();
    container.addEventListener('pointerdown', seenByAncestor);
    const ev = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' });
    act(() => {
      pill().dispatchEvent(ev);
    });
    expect(seenByAncestor).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(false);
    expect(tooltip()).toBeNull();
  });

  it('flips below the pill near the top of the viewport, otherwise sits above', () => {
    mount({ department: LONG });
    setTruncated(true);
    setPillRect({ top: 300, bottom: 320, left: 40, width: 120 });
    hoverIn();
    elapse(SHOW_DELAY_MS);
    expect(tooltip()!.className).toContain('-translate-y-full');
    expect(tooltip()!.style.top).toBe('294px');
    hoverOut();

    setPillRect({ top: 10, bottom: 30, left: 40, width: 120 });
    hoverIn();
    elapse(SHOW_DELAY_MS);
    expect(tooltip()!.className).not.toContain('-translate-y-full');
    expect(tooltip()!.style.top).toBe('36px');
  });

  it('hides on scroll and is removed with the pill on unmount', () => {
    mount({ department: LONG });
    setTruncated(true);
    hoverIn();
    elapse(SHOW_DELAY_MS);
    expect(tooltip()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(tooltip()).toBeNull();

    hoverIn();
    elapse(SHOW_DELAY_MS);
    expect(tooltip()).not.toBeNull();
    act(() => root!.unmount());
    root = null;
    expect(tooltip()).toBeNull();
  });
});
