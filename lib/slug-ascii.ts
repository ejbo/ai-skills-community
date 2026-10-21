// ASCII 版标题 slug：中文转拼音（pinyin-pro，无调），其余按 titleSlug 规则。
//
// owner 2026-10-21：「分享出去的时候链接会变成编码，不显示中文标题……就算是英文也行」——微信 / WeLink 里粘贴
// 带中文的 URL 会被百分号编码成一长串，拼音链接至少可读、可点、可念。目前只给报告用（pickReportSlug）；
// 站内其他内容仍是保留中文的 titleSlug（docs/contracts/slugs.md），要不要一起换是 owner 的产品决定。
// 服务端专用：pinyin-pro 带字典，不进客户端包。

import { pinyin } from 'pinyin-pro';
import { titleSlug } from '@/lib/slug';

const HAS_CJK = /[㐀-鿿豈-﫿]/;

/** 「加研思想院 · 2026 年 9 月月报」→ "jia-yan-si-xiang-yuan-2026-nian-9-yue-yue-bao"。没有中文时与 titleSlug 完全一致。 */
export function asciiTitleSlug(title: string, max?: number): string {
  const t = (title ?? '').trim();
  if (!t) return '';
  if (!HAS_CJK.test(t)) return titleSlug(t, max);
  // nonZh: 'consecutive' 把非中文连成一段原样返回；每个汉字一个音节。音节之间用空格隔开，再交给 titleSlug 变成 '-'。
  const parts = pinyin(t, { toneType: 'none', type: 'array', nonZh: 'consecutive', v: true });
  return titleSlug(parts.join(' '), max);
}
