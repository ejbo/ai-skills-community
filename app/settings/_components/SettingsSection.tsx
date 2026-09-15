// Page header + section card for /settings. Server-safe (no hooks) so pages and
// client editors render the same frame.

import type { ReactNode } from 'react';
import { CARD_CLS } from './ui';

export function SettingsPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SettingsSection({
  title,
  description,
  actions,
  index,
  children,
  className = '',
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Optional step number ("01") for editors that read top-to-bottom. */
  index?: number;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`${CARD_CLS} p-5 sm:p-6 ${className}`}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-start gap-3">
          {index !== undefined && (
            <span className="mt-0.5 font-mono text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
              {String(index).padStart(2, '0')}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h3>
            {description && <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
