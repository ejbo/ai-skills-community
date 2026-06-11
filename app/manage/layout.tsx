import Link from 'next/link';
import { ArrowLeft, LayoutDashboard, Users, Package, Clapperboard, FolderTree, History, FileText } from 'lucide-react';
import { requireAdmin } from '@/lib/admin';
import './manage.css';

export default async function ManageLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();

  const links = [
    { href: '/manage', label: '仪表盘', icon: <LayoutDashboard className="h-4 w-4" /> },
    { href: '/manage/users', label: '用户管理', icon: <Users className="h-4 w-4" /> },
    { href: '/manage/skills', label: 'Skill 审核', icon: <Package className="h-4 w-4" /> },
    { href: '/manage/videos', label: '视频管理', icon: <Clapperboard className="h-4 w-4" /> },
    { href: '/manage/categories', label: '类别', icon: <FolderTree className="h-4 w-4" /> },
    { href: '/manage/logs', label: '操作日志', icon: <History className="h-4 w-4" /> },
    { href: '/manage/changelogs', label: '更新日志', icon: <FileText className="h-4 w-4" /> },
  ];

  return (
    <div className="manage-shell min-h-screen bg-[#f8f9fb] font-admin text-[13px] text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
      <aside className="fixed inset-y-0 left-0 z-30 w-[220px] border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex h-14 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
          <span className="text-sm font-semibold tracking-tight">管理后台</span>
        </div>
        <nav className="flex flex-col gap-0.5 p-2">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              {l.icon}
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="absolute inset-x-0 bottom-0 border-t border-zinc-200 p-3 text-xs text-muted dark:border-zinc-800">
          已登录：{session.user.displayName}
        </div>
      </aside>

      <header className="fixed inset-x-0 left-[220px] top-0 z-20 flex h-14 items-center justify-between border-b border-zinc-200 bg-white/85 px-6 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85">
        <h1 className="text-sm font-semibold">AI Community · Admin</h1>
        <Link
          href="/"
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          <ArrowLeft className="h-3 w-3" />
          返回主站
        </Link>
      </header>

      <main className="ml-[220px] mt-14 p-6">{children}</main>
    </div>
  );
}
