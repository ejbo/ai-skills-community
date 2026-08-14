import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Homepage section heading: icon, title, optional "view all" link, closed by a
 * hairline rule.
 *
 * The icon used to sit in a tinted accent chip and the link used to be accent
 * blue; both are now ink on paper. The rule is what carries the hierarchy, the
 * way a section break does in print, so sections read as structure rather than
 * as a stack of coloured badges.
 */
export function SectionHeader({
  icon,
  title,
  href,
  linkLabel,
}: {
  icon: ReactNode;
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3 border-b border-zinc-200/90 pb-3 dark:border-zinc-800">
      <h2 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
        <span className="text-zinc-400 dark:text-zinc-500">{icon}</span>
        {title}
      </h2>
      {href && linkLabel && (
        <Link
          href={href}
          className="group mb-0.5 flex shrink-0 items-center gap-1 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          {linkLabel}
          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}
