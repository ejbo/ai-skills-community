// 页面访问 (PageVisit) — route → display name, plus the admin redaction rule.
//
// IMPORT-FREE (unit-tested; shared by the tracker route and the manage UI).
//
// Coverage contract: EVERY `app/**/page.tsx` route has an entry here, and only
// real routes do — tests/page-visit.test.ts walks the app directory and fails
// the moment a page is added without a name (or an entry goes stale). Unknown
// paths are still recorded (pageName null → the UI shows the raw path), so a
// missed page never silently disappears from a user's history again.
//
// Redaction contract: a staff viewer's visit to a USER-SPECIFIC page is stored
// with the identifying segment replaced by the route template ("/users/[handle]",
// "/manage/users/[id]") — the activity is kept, WHO they looked at is not.

export type PageNameEntry = readonly [template: string, name: string];

export const PAGE_NAMES: readonly PageNameEntry[] = [
  ['/', '首页'],
  ['/search', '搜索'],
  ['/auth/login', '登录'],
  ['/auth/signup', '注册'],
  ['/auth/error', '登录错误'],

  ['/skills', 'Skills 浏览'],
  ['/skills/new', '上传 Skill'],
  ['/skills/[slug]', 'Skill 详情'],
  ['/skills/[slug]/edit', '编辑 Skill'],
  ['/skills/[slug]/remix', 'Remix Skill'],
  ['/skills/[slug]/manage', 'Skill 管理面板'],
  ['/packs/[slug]', '合集包详情'],
  ['/categories', '类别'],

  ['/dashboard', '我的面板'],
  ['/users/[handle]', '用户主页'],
  ['/settings', '账号设置'],
  ['/settings/notifications', '通知设置'],
  ['/settings/privacy', '隐私设置'],
  ['/settings/tokens', 'CLI Token'],
  ['/settings/security', '安全设置'],
  ['/settings/language', '语言设置'],

  ['/docs', '文档中心'],
  ['/docs/start', '文档 · 快速开始'],
  ['/docs/cli', '文档 · CLI'],
  ['/docs/authoring', '文档 · 编写规范'],
  ['/docs/publish', '文档 · 发布'],
  ['/docs/discussion', '文档 · 讨论区'],
  ['/docs/library', '文档 · 知识库'],
  ['/docs/events', '文档 · 活动'],
  ['/docs/zones', '文档 · 技术专区'],
  ['/docs/account', '文档 · 账号'],
  ['/docs/conduct', '文档 · 社区守则'],
  ['/docs/content', '文档 · 内容规范'],

  ['/announcements/[id]', '公告详情'],
  ['/feedback', '意见反馈'],
  ['/feedback/[id]', '反馈详情'],

  ['/discussion', '讨论区'],
  ['/discussion/posts/[id]', '动态详情'],
  ['/discussion/topics/new', '发起话题'],
  ['/discussion/topics/[id]', '话题详情'],
  ['/discussion/topics/[id]/edit', '编辑话题'],

  ['/events', '活动'],
  ['/events/new', '创建活动'],
  ['/events/[id]', '活动详情'],
  ['/events/[id]/edit', '编辑活动'],

  ['/library', '知识库'],
  ['/library/shelf', '我的书架'],
  ['/library/[slug]', '文档详情'],
  ['/library/[slug]/read', '阅读文档'],
  ['/library/[slug]/edit', '编辑文档'],

  ['/videos', 'Videos'],
  ['/videos/shorts', '随刷短视频'],
  ['/videos/[slug]', '视频详情'],

  ['/votes', '投票活动'],
  ['/votes/new', '创建投票活动'],
  ['/votes/[id]', '投票活动详情'],
  ['/votes/[id]/edit', '编辑投票活动'],

  ['/zones', '技术专区'],
  ['/zones/new', '创建版块'],
  ['/zones/[slug]', '版块主页'],
  ['/zones/[slug]/members', '版块成员'],
  ['/zones/[slug]/settings', '版块设置'],
  ['/zones/[slug]/posts/new', '发布版块帖子'],
  ['/zones/[slug]/posts/[postId]', '版块帖子详情'],
  ['/zones/[slug]/posts/[postId]/edit', '编辑版块帖子'],
  ['/zones/[slug]/wiki', '版块 Wiki'],
  ['/zones/[slug]/wiki/new', '新建 Wiki 页面'],
  ['/zones/[slug]/wiki/[pageSlug]', 'Wiki 页面'],
  ['/zones/[slug]/wiki/[pageSlug]/edit', '编辑 Wiki 页面'],
  ['/zones/[slug]/wiki/[pageSlug]/history', 'Wiki 修订历史'],

  ['/manage', '管理仪表盘'],
  ['/manage/users', '用户管理'],
  ['/manage/users/[id]', '用户详情'],
  ['/manage/roles', '角色与权限'],
  ['/manage/employees', '员工名单'],
  ['/manage/skills', 'Skill 审核'],
  ['/manage/skills/[slug]', 'Skill 审核详情'],
  ['/manage/packs', '合集包管理'],
  ['/manage/videos', '视频管理'],
  ['/manage/videos/new', '新建视频'],
  ['/manage/videos/[id]/edit', '编辑视频'],
  ['/manage/shorts', '短视频管理'],
  ['/manage/discussion', '讨论管理'],
  ['/manage/votes', '投票活动管理'],
  ['/manage/zones', '技术专区管理'],
  ['/manage/library', '知识库管理'],
  ['/manage/categories', '类别管理'],
  ['/manage/announcements', '公告管理'],
  ['/manage/logs', '操作日志'],
];

/** Templates whose dynamic segment identifies a PERSON. Redacted for staff viewers. */
export const USER_SPECIFIC_TEMPLATES: readonly string[] = ['/users/[handle]', '/manage/users/[id]'];

interface Compiled {
  template: string;
  name: string;
  re: RegExp;
  /** Static segments — a static segment matches only itself, so more = more specific. */
  specificity: number;
}

function compileTemplate(template: string): { re: RegExp; specificity: number } {
  const segs = template.split('/').filter(Boolean);
  let specificity = 0;
  const parts = segs.map((seg) => {
    if (/^\[\.\.\..+\]$/.test(seg)) return '.+';
    if (/^\[.+\]$/.test(seg)) return '[^/]+';
    specificity += 1;
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return { re: new RegExp(`^/${parts.join('/')}$`), specificity };
}

const COMPILED: readonly Compiled[] = PAGE_NAMES.map(([template, name]) => ({
  template,
  name,
  ...compileTemplate(template),
}));

const USER_SPECIFIC: readonly Compiled[] = COMPILED.filter((c) => USER_SPECIFIC_TEMPLATES.includes(c.template));

/** Strip query/hash, collapse trailing slashes, guarantee a leading slash. */
export function normalizePath(input: string): string {
  let p = input.split(/[?#]/)[0] ?? '';
  if (!p.startsWith('/')) p = '/' + p;
  p = p.replace(/\/+/g, '/');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p;
}

function bestMatch(path: string): Compiled | null {
  let best: Compiled | null = null;
  for (const c of COMPILED) {
    if (!c.re.test(path)) continue;
    if (!best || c.specificity > best.specificity) best = c;
  }
  return best;
}

/** Route template the path belongs to (e.g. "/skills/[slug]"), or null. */
export function resolvePageTemplate(path: string): string | null {
  return bestMatch(normalizePath(path))?.template ?? null;
}

export function resolvePageName(path: string): string | null {
  return bestMatch(normalizePath(path))?.name ?? null;
}

/** Basic hygiene only — unknown pages ARE logged (see the coverage contract above). */
export function shouldLogPath(path: string): boolean {
  if (!path) return false;
  const p = normalizePath(path);
  if (p.startsWith('/api/')) return false;
  if (p.startsWith('/_next/')) return false;
  if (p.startsWith('/static/')) return false;
  if (p.startsWith('/favicon')) return false;
  if (/\.[a-z0-9]{2,5}$/i.test(p)) return false;
  return true;
}

/**
 * If `path` points at a specific user, return the redacted form (the route
 * template) — otherwise null. Applied at WRITE time for staff viewers, and at
 * display time for rows written before the rule existed.
 */
export function redactUserSpecificPath(path: string): string | null {
  const p = normalizePath(path);
  for (const c of USER_SPECIFIC) if (c.re.test(p)) return c.template;
  return null;
}

/**
 * What to store for the `Referer` header. The tracker fires from the visited page
 * itself, so the header is the CURRENT url (full, with query) — it must go through
 * the same hygiene as `path`: pathname only, basePath stripped, redacted for staff.
 */
export function sanitizeReferrer(raw: string | null | undefined, staff: boolean, basePath = ''): string | null {
  if (!raw) return null;
  let pathname: string;
  try {
    pathname = new URL(raw).pathname;
  } catch {
    return null;
  }
  if (basePath && (pathname === basePath || pathname.startsWith(basePath + '/'))) {
    pathname = pathname.slice(basePath.length) || '/';
  }
  const p = normalizePath(pathname);
  if (!shouldLogPath(p)) return null;
  return staff ? (redactUserSpecificPath(p) ?? p) : p;
}

/** A stored path that has already been redacted (contains a template segment). */
export function isRedactedPath(path: string): boolean {
  return USER_SPECIFIC_TEMPLATES.includes(path);
}

/**
 * The path to SHOW for a visit row: staff viewers' user-specific visits are
 * masked whether they were stored redacted or predate the rule.
 */
export function displayVisitPath(storedPath: string, viewedUserIsStaff: boolean): { path: string; redacted: boolean } {
  if (isRedactedPath(storedPath)) return { path: storedPath, redacted: true };
  if (!viewedUserIsStaff) return { path: storedPath, redacted: false };
  const r = redactUserSpecificPath(storedPath);
  return r ? { path: r, redacted: true } : { path: storedPath, redacted: false };
}
