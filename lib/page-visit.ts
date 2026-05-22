const PAGE_NAME_MAP: Array<{ test: (p: string) => boolean; name: string }> = [
  { test: (p) => p === '/', name: '首页' },
  { test: (p) => p === '/skills', name: 'Skills 浏览' },
  { test: (p) => /^\/skills\/[^/]+$/.test(p), name: 'Skill 详情' },
  { test: (p) => p === '/skills/new', name: '上传 Skill' },
  { test: (p) => /^\/skills\/[^/]+\/edit$/.test(p), name: '编辑 Skill' },
  { test: (p) => /^\/skills\/[^/]+\/remix$/.test(p), name: 'Remix Skill' },
  { test: (p) => p === '/dashboard', name: '我的面板' },
  { test: (p) => p === '/categories', name: '类别' },
  { test: (p) => /^\/categories\/[^/]+$/.test(p), name: '类别详情' },
  { test: (p) => /^\/users\/[^/]+$/.test(p), name: '用户主页' },
  { test: (p) => p === '/settings', name: '账号设置' },
  { test: (p) => p.startsWith('/settings/'), name: '账号设置' },
  { test: (p) => p === '/docs/cli', name: 'CLI 文档' },
  { test: (p) => p === '/docs/authoring', name: '编写规范' },
  { test: (p) => p === '/auth/login', name: '登录' },
  { test: (p) => p === '/auth/signup', name: '注册' },
  { test: (p) => p === '/manage', name: '管理仪表盘' },
  { test: (p) => p === '/manage/users', name: '用户管理' },
  { test: (p) => /^\/manage\/users\/[^/]+$/.test(p), name: '用户详情' },
  { test: (p) => p === '/manage/skills', name: 'Skill 审核' },
  { test: (p) => p === '/manage/logs', name: '操作日志' },
];

export function resolvePageName(path: string): string | null {
  for (const { test, name } of PAGE_NAME_MAP) {
    if (test(path)) return name;
  }
  return null;
}

export function shouldLogPath(path: string): boolean {
  if (!path) return false;
  if (path.startsWith('/api/')) return false;
  if (path.startsWith('/_next/')) return false;
  if (path.startsWith('/static/')) return false;
  if (path.startsWith('/favicon')) return false;
  if (/\.[a-z0-9]{2,5}$/i.test(path)) return false;
  return resolvePageName(path) !== null;
}
