'use client';

// 评论抽屉（报告帖子，docs/contracts/reports.md §3a「阅读布局」）：报告动辄几千字，评论在最底下「拉到最底下非常困难」
// （owner 2026-10-21）。右栏的「评论 N」和动作条的评论按钮都打开这个从右侧滑入的抽屉，里面就是同一个 PostComments；
// 抽屉开着时页面底部的评论区不渲染（同一时刻只挂一份，计数和线程不会分叉）。ESC / 遮罩 / 关闭按钮关闭。
// 窄屏（< lg）是全宽；它和预览 dock 都在右侧，所以用更高的 z 盖在 dock 之上——两者不会同时需要。

import { useEffect, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { MessageCircle, X } from 'lucide-react';
import { SPRING_DRAWER, TWEEN_FAST } from '@/lib/motion';

/** 评论抽屉 = 通用右侧抽屉 + 评论标题；「谁看过」等别的面板也用 SideDrawer。 */
export function CommentsDrawer({ open, onClose, count, children }: { open: boolean; onClose: () => void; count: number; children: ReactNode }) {
  const t = useTranslations('zones');
  return (
    <SideDrawer open={open} onClose={onClose} title={t('post_comments')} count={count} icon={<MessageCircle className="h-4 w-4 text-muted" />} closeLabel={t('report_comments_close')}>
      {children}
    </SideDrawer>
  );
}

export function SideDrawer({ open, onClose, title, count, icon, closeLabel, children }: { open: boolean; onClose: () => void; title: string; count?: number | null; icon?: ReactNode; closeLabel: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            className="fixed inset-0 z-[70] bg-zinc-900/30 dark:bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={TWEEN_FAST}
            onClick={onClose}
            aria-hidden
          />
          <motion.aside
            key="drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="fixed inset-y-0 right-0 z-[71] flex w-full max-w-[32rem] flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
            initial={reduce ? { opacity: 0 } : { x: '100%' }}
            animate={reduce ? { opacity: 1 } : { x: 0 }}
            exit={reduce ? { opacity: 0 } : { x: '100%' }}
            transition={reduce ? TWEEN_FAST : SPRING_DRAWER}
          >
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-200 px-5 dark:border-zinc-800">
              {icon}
              <h2 id={titleId} className="text-base font-semibold tracking-tight">
                {title}
              </h2>
              {count != null && <span className="font-mono text-sm tabular-nums text-muted">{count}</span>}
              <button type="button" onClick={onClose} aria-label={closeLabel} className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
