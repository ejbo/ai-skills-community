import { Building2 } from 'lucide-react';

/**
 * 部门 / 研究所 badge shown next to a user's name (posts, comments, profiles).
 * Server-safe (no hooks). Renders nothing when both fields are empty — callers
 * can always include it unconditionally.
 *
 * Privacy contract: pass values that already went through `toPublicAuthor()`
 * (lib/user-identity.ts) — for a private account they arrive as null, so this
 * renders nothing. Do NOT hide client-side with raw values.
 */
export function DeptTag({
  department,
  lab,
  className = '',
}: {
  department?: string | null;
  lab?: string | null;
  className?: string;
}) {
  const text = [department, lab].filter(Boolean).join(' · ');
  if (!text) return null;
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] leading-4 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 ${className}`}
      title={text}
    >
      <Building2 className="h-3 w-3 shrink-0" />
      <span className="truncate">{text}</span>
    </span>
  );
}
