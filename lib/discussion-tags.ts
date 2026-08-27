// 讨论区主题分类 — 纯逻辑（客户端/服务端共用，不碰 prisma）。
// DB 侧的 listDiscussionTags / findOrCreateDiscussionTag 在 lib/discussion-queries.ts。
//
// 两级模型：
//   official = 左侧栏分类。内置那 8 个，可筛选、有计数，每篇帖必须至少带一个。
//   自建     = 成员在发帖时现建的，只作为 chip 挂在帖子上，永远不进侧栏。
// 侧栏因此不会被刷爆，而自建分类仍是全站共享的（同名自动复用，见 findOrCreate）。

/** 一篇帖最多挂几个侧栏分类（至少 1 个）。 */
export const MAX_OFFICIAL_TAGS = 3;
/** 一篇帖最多挂几个自建分类。 */
export const MAX_CUSTOM_TAGS = 3;

export const TAG_NAME_MIN = 2;
export const TAG_NAME_MAX = 24;

/** 退役值：老帖还在上面，但发帖入口不再提供。 */
export const RETIRED_TAG_SLUGS: ReadonlySet<string> = new Set(['general']);

export interface DiscussionTagOption {
  slug: string;
  name: string;
  nameEn: string;
  official: boolean;
}

/**
 * 内置分类的标签走 i18n（labels.discussionCategory.*），自建的渲染存储名。
 * 与 components/library/CategoryPicker.tsx#categoryLabel 同一套规则。
 */
export function discussionTagLabel(
  tag: DiscussionTagOption,
  locale: string,
  tl: (key: string) => string,
): string {
  if (tag.official) {
    const key = `discussionCategory.${tag.slug}`;
    const translated = tl(key);
    // next-intl renders the raw key path when a message is missing.
    if (!translated.includes(key)) return translated;
  }
  return locale.startsWith('zh') ? tag.name : tag.nameEn || tag.name;
}

/**
 * 自建分类没有固定配色 — 从 slug 稳定地散列到调色板下标，同一个分类在
 * 列表页/详情页/选择器里永远是同一个颜色。
 */
export function tagColorIndex(slug: string, paletteSize: number): number {
  let hash = 0;
  for (const ch of slug) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return hash % Math.max(1, paletteSize);
}

/**
 * 成员输入的分类名 → slug。拉丁名直接 slugify；转写不出东西的（纯中文等）
 * 退化成名字的短哈希 —— slug 只是标识符，从不作为展示文本。
 *
 * 与 lib/library/categories.ts#slugifyCategory 同源，但「够不够拉丁」判的是
 * 剩下的**字母数字**而不是含连字符的长度：後者会把「A 模型」slug 成 `a-`，
 * 而「A 数据」也是 `a-` —— 两个不同的分类撞成同一个骨架，只能靠去重循环
 * 兜成 `a--2`。这里让这种名字直接走哈希。
 */
export function slugifyDiscussionTag(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const latin = base
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (latin.replace(/-/g, '').length >= 2) {
    return latin.slice(0, 32).replace(/-+$/, '');
  }
  let hash = 0;
  for (const ch of name.trim()) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return `d${hash.toString(36)}`;
}

/** 折叠内部空白后的规范名 —— 建之前、查重之前都过这一道。 */
export function normalizeTagName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function isValidTagName(name: string): boolean {
  const n = normalizeTagName(name);
  return n.length >= TAG_NAME_MIN && n.length <= TAG_NAME_MAX;
}

export type TagSanitizeError = 'unknown_tag' | 'no_official' | 'too_many_official' | 'too_many_custom';

export interface TagSanitizeResult {
  /** 侧栏分类在前（categories[0] 因此恒为 official），自建的跟在后面。 */
  categories: string[];
  official: string[];
  custom: string[];
}

/**
 * 校验并归一化一篇帖的分类数组：全部 slug 必须真实存在，官方 1..3 个、自建
 * 0..3 个，去重，官方排前。发帖/改帖两条 API 共用这一处规则。
 */
export function sanitizeTopicTags(
  slugs: readonly string[],
  known: ReadonlyMap<string, DiscussionTagOption>,
): { ok: true; value: TagSanitizeResult } | { ok: false; error: TagSanitizeError } {
  const seen = new Set<string>();
  const official: string[] = [];
  const custom: string[] = [];
  for (const raw of slugs) {
    const slug = typeof raw === 'string' ? raw.trim() : '';
    if (!slug || seen.has(slug)) continue;
    // 退役分类静默丢弃而不是报错：编辑一篇老帖时它本来就带着 general，
    // 报错会把作者卡死在一个他没法修的表单上（TopicForm 的 retired 提示
    // 讲的就是这件事）。
    if (RETIRED_TAG_SLUGS.has(slug)) continue;
    const tag = known.get(slug);
    if (!tag) return { ok: false, error: 'unknown_tag' };
    seen.add(slug);
    (tag.official ? official : custom).push(slug);
  }
  if (official.length === 0) return { ok: false, error: 'no_official' };
  if (official.length > MAX_OFFICIAL_TAGS) return { ok: false, error: 'too_many_official' };
  if (custom.length > MAX_CUSTOM_TAGS) return { ok: false, error: 'too_many_custom' };
  return { ok: true, value: { categories: [...official, ...custom], official, custom } };
}

/** sanitizeTopicTags 的错误 → 面向用户的原因（两条写路由共用）。 */
export function tagErrorReason(error: TagSanitizeError): string {
  switch (error) {
    case 'no_official':
      return '请至少选择一个侧栏分类';
    case 'too_many_official':
      return `最多选择 ${MAX_OFFICIAL_TAGS} 个侧栏分类`;
    case 'too_many_custom':
      return `最多添加 ${MAX_CUSTOM_TAGS} 个自定义分类`;
    default:
      return '分类不存在，请重新选择';
  }
}
