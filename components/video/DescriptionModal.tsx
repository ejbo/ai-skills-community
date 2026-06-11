'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';

/**
 * Full-screen markdown reading modal, shared by the detail page's description
 * card and the home hero's 详情 button. Optionally links through to the detail page.
 */
export function DescriptionModal({
  open,
  onClose,
  title,
  content,
  detailHref,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  content: string;
  detailHref?: string;
}) {
  const t = useTranslations('video');
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="surface relative z-10 flex h-[85vh] w-full max-w-3xl animate-slide-up flex-col overflow-hidden rounded-2xl shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <h2 className="min-w-0 truncate text-sm font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5">
          <MarkdownRenderer content={content} />
        </div>
        {detailHref && (
          <div className="flex shrink-0 justify-end border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <Link
              href={detailHref}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent-500 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-accent-600"
            >
              {t('home.go_detail')}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
