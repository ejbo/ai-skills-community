// Node environment ON PURPOSE (no `document`/`window`): DeptTag is imported by
// React Server Components and must render on the server without touching the DOM.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { DeptTag } from '@/components/DeptTag';

const LONG_DEPT = 'ICT BG-计算产品线-昇腾计算业务部-昇腾软件开发部';

describe('DeptTag (server render)', () => {
  it('renders nothing when both fields are empty', () => {
    expect(renderToString(createElement(DeptTag, {}))).toBe('');
    expect(renderToString(createElement(DeptTag, { department: null, lab: '' }))).toBe('');
  });

  it('joins department · lab, caps the pill width and ellipsizes the label', () => {
    // React 18 warns when a server render reaches useLayoutEffect; the pill is
    // SSR'd on ~30 routes, so that warning must never come back.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = renderToString(createElement(DeptTag, { department: LONG_DEPT, lab: '推理框架实验室' }));
    expect(errors.mock.calls.map((c) => String(c[0]))).toEqual([]);
    errors.mockRestore();
    expect(html).toContain(`${LONG_DEPT} · 推理框架实验室`);
    expect(html).toContain('max-w-[12rem]');
    expect(html).toContain('min-w-0'); // lets a narrow flex row shrink the pill below the cap
    expect(html).not.toContain('min(100%'); // cyclic percentage — see DeptTag.tsx
    expect(html).toContain('class="truncate"');
    // No native title: the portaled tooltip is the single hover surface.
    expect(html).not.toContain('title=');
    // The tooltip itself is never part of the server markup (client-only, on demand).
    expect(html).not.toContain('role="tooltip"');
  });

  it('`full` drops the width cap (identity headers) and keeps the caller className', () => {
    const html = renderToString(createElement(DeptTag, { department: LONG_DEPT, full: true, className: 'mt-1.5' }));
    expect(html).not.toContain('12rem');
    expect(html).toContain('max-w-full');
    expect(html).toContain('mt-1.5');
    // Never ellipsized: on a narrow header the path wraps, since there is no tooltip to fall back on.
    expect(html).not.toContain('truncate');
    expect(html).toContain('break-words');
  });
});
