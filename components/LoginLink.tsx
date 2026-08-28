'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { currentLoginHref, loginHref } from '@/lib/auth/callback-path';

/**
 * A link to the login page that brings the visitor back to where they are.
 *
 * It stays a real `<Link>` — the href is correct for keyboard, middle-click and
 * copy-link — but a plain click upgrades to the FULL url including the query.
 * `usePathname()` has no query string, and `?focus=<commentId>` / `?v=<short>`
 * is usually the whole reason the link was shared; `useSearchParams()` would
 * fix that but opts every page rendering this out of static rendering, and the
 * navbar renders it on every page.
 *
 * `loginHref` refuses `/auth/*` destinations, so this is safe to render on the
 * login and error pages too (it degrades to a bare `/auth/login`).
 */
export function LoginLink({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <Link
      href={loginHref(pathname)}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        if (!window.location.search) return;
        e.preventDefault();
        router.push(currentLoginHref());
      }}
      className={className}
    >
      {children}
    </Link>
  );
}
