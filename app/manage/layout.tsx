import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowLeft,
  LayoutDashboard,
  Users,
  BookOpen,
  BookUser,
  Package,
  Boxes,
  Clapperboard,
  FolderTree,
  History,
  Layers,
  Megaphone,
  MessagesSquare,
  Play,
  ShieldCheck,
  Vote,
} from 'lucide-react';
import { getManageActor } from '@/lib/admin';
import { manageSectionsFor, type PermissionKey } from '@/lib/permissions';
import './manage.css';

const ICONS: Partial<Record<PermissionKey, React.ReactNode>> = {
  dashboard: <LayoutDashboard className="h-4 w-4" />,
  users: <Users className="h-4 w-4" />,
  employees: <BookUser className="h-4 w-4" />,
  skills: <Package className="h-4 w-4" />,
  packs: <Boxes className="h-4 w-4" />,
  videos: <Clapperboard className="h-4 w-4" />,
  shorts: <Play className="h-4 w-4" />,
  discussion: <MessagesSquare className="h-4 w-4" />,
  zones: <Layers className="h-4 w-4" />,
  votes: <Vote className="h-4 w-4" />,
  library: <BookOpen className="h-4 w-4" />,
  categories: <FolderTree className="h-4 w-4" />,
  announcements: <Megaphone className="h-4 w-4" />,
  logs: <History className="h-4 w-4" />,
};

export default async function ManageLayout({ children }: { children: React.ReactNode }) {
  // Staff gate (any permission). Each section page adds its own requirePermission().
  const actor = await getManageActor();
  if (!actor) redirect('/');
  const { session, role } = actor;

  const links = manageSectionsFor(role).map((s) => ({ href: s.href, label: s.label, icon: ICONS[s.perm] }));
  if (role.isSuperAdmin) {
    const i = links.findIndex((l) => l.href === '/manage/users');
    links.splice(i >= 0 ? i + 1 : links.length, 0, {
      href: '/manage/roles',
      label: '角色与权限',
      icon: <ShieldCheck className="h-4 w-4" />,
    });
  }

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
          {links.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted">当前角色没有可用的后台板块。</p>
          )}
        </nav>
        <div className="absolute inset-x-0 bottom-0 border-t border-zinc-200 p-3 text-xs text-muted dark:border-zinc-800">
          <div className="truncate">已登录：{session.user.displayName}</div>
          <div className="truncate text-[11px]">角色：{role.roleName}</div>
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
