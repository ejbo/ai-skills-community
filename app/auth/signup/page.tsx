import { redirect } from 'next/navigation';
import { loginHref } from '@/lib/auth/callback-path';

// House rule: page searchParams may be string[] — always read via firstParam.
function firstParam(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? '' : v ?? '';
}

/**
 * 注册入口已关闭（2026-08-27，owner decision）：账号来自 W3 首次登录或 `pnpm db:seed`，
 * 页面不再提供自助注册表单，`POST /api/auth/register` 一律 403。
 *
 * 这个路由本身保留而不是删掉，有两个原因：旧书签/外链落到这里应该被送去登录而不是
 * 404；并且 lib/page-visit.ts 的覆盖契约（tests/page-visit.test.ts 双向校验）要求
 * `app/**\/page.tsx` 与 PAGE_NAMES 一一对应 —— 删掉页面就必须同时删掉那条记录。
 *
 * 目标写成裸路径：RSC 的 redirect() 会自己补 basePath（pitfall #4 说的“不会自动加前缀”
 * 指的是 Auth.js 自己发出的 Location，不是这里）。
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string | string[] };
}) {
  redirect(loginHref(firstParam(searchParams.callbackUrl) || null));
}
