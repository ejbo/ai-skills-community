import Link from 'next/link';
import { redirect } from 'next/navigation';
import { User, Key, Lock, Bell } from 'lucide-react';
import { auth } from '@/lib/auth';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/auth/login?callbackUrl=/settings');

  const links = [
    { href: '/settings', label: '个人资料', icon: <User className="h-4 w-4" /> },
    { href: '/settings/notifications', label: '通知', icon: <Bell className="h-4 w-4" /> },
    { href: '/settings/tokens', label: 'CLI Token', icon: <Key className="h-4 w-4" /> },
    { href: '/settings/security', label: '安全', icon: <Lock className="h-4 w-4" /> },
  ];

  return (
    <div className="container py-8">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">账号设置</h1>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_1fr]">
        <aside>
          <nav className="flex flex-col gap-0.5">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
              >
                {l.icon}
                {l.label}
              </Link>
            ))}
          </nav>
        </aside>
        <div>{children}</div>
      </div>
    </div>
  );
}
