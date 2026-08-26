// @vitest-environment jsdom
//
// 批量选中/删除的交互契约：勾了什么，就只对什么动手。
// 重点是 ids 与「全选筛选结果」两条路径不能串味 —— 后者会对屏幕外的行生效。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const toasts = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/components/Toaster', () => ({ pushToast: toasts.push }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { EmployeeManager, type EmployeeRow } from '@/app/manage/employees/EmployeeManager';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (id: string, name: string): EmployeeRow => ({
  id,
  name,
  accountNumber: `z${id}`,
  department: 'AI事业部',
  lab: '',
  avatarUrl: '',
  isActive: true,
  updatedAt: '2026-08-26T00:00:00.000Z',
  hasUser: false,
});

const ROWS = [row('1', '张三'), row('2', '李四'), row('3', '王五')];
const FILTER = { q: '张', department: '', lab: '', dup: false };

let container: HTMLDivElement;
let root: Root | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

function mount(props: Partial<Parameters<typeof EmployeeManager>[0]> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(EmployeeManager, { rows: ROWS, total: 120, filter: FILTER, filtered: true, ...props }),
    );
  });
}

const checkboxes = () => Array.from(container.querySelectorAll<HTMLInputElement>('table input[type="checkbox"]'));
const headBox = () => checkboxes()[0];
/** 行复选框（表头之后的那些），顺序与 ROWS 一致。 */
const rowBox = (i: number) => checkboxes()[i + 1];
const button = (label: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(label));

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function clickAsync(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const lastBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, affected: 3, syncedUsers: 0 }) }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('confirm', vi.fn(() => true));
  toasts.push.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  vi.unstubAllGlobals();
});

describe('EmployeeManager 批量选择', () => {
  it('没有勾选时不显示批量栏', () => {
    mount();
    expect(button('批量删除')).toBeUndefined();
  });

  it('勾一行 → 只把那一行的 id 发给批量接口', async () => {
    mount();
    click(rowBox(1));
    expect(container.textContent).toContain('已选 1 条');
    await clickAsync(button('批量删除')!);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/employees/bulk', expect.objectContaining({ method: 'POST' }));
    expect(lastBody()).toEqual({ action: 'delete', ids: ['2'] });
  });

  it('表头全选 → 本页三行的 id；不会变成「全表」', async () => {
    mount();
    click(headBox());
    expect(container.textContent).toContain('已选 3 条');
    await clickAsync(button('批量停用')!);
    expect(lastBody()).toEqual({ action: 'deactivate', ids: ['1', '2', '3'] });
  });

  it('「选择全部 N 条」→ 改发 filter，且只在本页全选后才出现', async () => {
    mount();
    expect(button('选择全部')).toBeUndefined();
    click(headBox());
    click(button('选择全部')!);
    expect(container.textContent).toContain('已选 120 条');
    expect(container.textContent).toContain('当前筛选全部');
    await clickAsync(button('批量启用')!);
    expect(lastBody()).toEqual({ action: 'activate', all: true, filter: FILTER });
  });

  it('全选筛选结果后再取消某一行 ⇒ 退回 ids 路径（绝不再对屏幕外的行动手）', async () => {
    mount();
    click(headBox());
    click(button('选择全部')!);
    click(rowBox(0)); // 取消第一行
    expect(container.textContent).toContain('已选 2 条');
    await clickAsync(button('批量删除')!);
    const body = lastBody();
    expect(body.all).toBeUndefined();
    expect(body.ids.sort()).toEqual(['2', '3']);
  });

  it('确认框点取消 ⇒ 什么都不发', async () => {
    mount();
    vi.stubGlobal('confirm', vi.fn(() => false));
    click(rowBox(0));
    await clickAsync(button('批量删除')!);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('确认文案要说清范围：全表 vs 当前筛选 vs 选中若干', async () => {
    const confirmMock = vi.fn((_message?: string) => true);
    vi.stubGlobal('confirm', confirmMock);
    mount({ filtered: false, total: 120 });
    click(headBox());
    click(button('选择全部')!);
    await clickAsync(button('批量删除')!);
    expect(confirmMock.mock.calls[0][0]).toContain('全部 120 条员工记录');
    expect(confirmMock.mock.calls[0][0]).toContain('不可撤销');
  });

  it('成功后清空勾选（批量栏消失）', async () => {
    mount();
    click(headBox());
    await clickAsync(button('批量删除')!);
    expect(button('批量删除')).toBeUndefined();
    expect(toasts.push).toHaveBeenCalledWith('success', expect.stringContaining('已删除 3 条'));
  });

  it('接口失败时保留勾选，便于重试', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'invalid_input' }) } as never);
    mount();
    click(rowBox(0));
    await clickAsync(button('批量删除')!);
    expect(toasts.push).toHaveBeenCalledWith('error', expect.stringContaining('输入有误'));
    expect(container.textContent).toContain('已选 1 条');
  });

  it('表头复选框半选态：勾一行是 indeterminate，勾满就不是', () => {
    mount();
    click(rowBox(0));
    expect(headBox().indeterminate).toBe(true);
    expect(headBox().checked).toBe(false);
    click(rowBox(1));
    click(rowBox(2));
    expect(headBox().indeterminate).toBe(false);
    expect(headBox().checked).toBe(true);
  });
});
