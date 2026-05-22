import Link from 'next/link';
import { BookOpen, Terminal, FileCode } from 'lucide-react';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const links = [
    { href: '/docs/cli', label: 'CLI 快速开始', icon: <Terminal className="h-4 w-4" /> },
    { href: '/docs/authoring', label: '编写规范', icon: <FileCode className="h-4 w-4" /> },
  ];
  return (
    <div className="container py-8">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[200px_1fr]">
        <aside>
          <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
            <BookOpen className="h-3.5 w-3.5" />
            文档
          </div>
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
        <article>{children}</article>
      </div>
    </div>
  );
}
