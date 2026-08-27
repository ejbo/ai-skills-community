'use client';

// 技术专区 — 加入 / 申请加入 / 已加入(退出) control for the zone header and the
// locked-state card. Policy is pre-decided by ZoneAccess (never re-derived here).
//
// BOTH overlays are body portals, for the same reason (ask #1): the header band
// is `relative overflow-hidden`, so anything absolutely positioned inside it is
// clipped at any z-index. The approval dialog portals itself; the 已加入 menu
// rides `useAnchoredPanel` — the same anchoring ZoneManageMenu uses, so the two
// header dropdowns can never drift apart.

import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Clock, Lock, LogOut, UserPlus, X } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { Magnetic } from '@/components/motion';
import { ZONE_LIMITS } from '@/lib/zones/shared';
import type { ZoneAccess, ZoneJoinPolicyView } from '@/lib/zones/types';
import { BTN_PRIMARY, BTN_SECONDARY, PILL_INK, PILL_MONO, TEXTAREA_CLS, loginHref, readError } from './ui';
import { useAnchoredPanel } from '@/components/useAnchoredPanel';

/** w-56, in px — the first-paint estimate; the real box is measured on open. */
const MENU_W = 224;

export function JoinButton({
  slug,
  name,
  access,
  joinPolicy,
  magnetic = true,
}: {
  slug: string;
  name: string;
  access: ZoneAccess;
  joinPolicy: ZoneJoinPolicyView;
  /** Wrap the primary CTA in Magnetic (one per page — the header passes false when 发布 is the primary). */
  magnetic?: boolean;
}) {
  const t = useTranslations('zones');
  const tl = useTranslations('labels');
  const router = useRouter();
  const pathname = usePathname();
  const menuId = useId();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // The confirm step grows the panel, so it feeds the height estimate and a
  // re-measure runs when it flips (the panel may need to flip above instead).
  const {
    open: menu,
    openPanel,
    close: closeMenu,
    pos,
    triggerRef,
    panelRef,
    host,
    place,
  } = useAnchoredPanel<HTMLButtonElement>({
    width: MENU_W,
    height: confirmLeave ? 132 : 40 + (access.roleName ? 34 : 0) + 8,
    onClose: () => setConfirmLeave(false),
  });

  useEffect(() => {
    if (menu) place();
  }, [confirmLeave, menu, place]);

  async function join(message: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/zones/${slug}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      if (res.status === 401) {
        pushToast('error', t('login_required'));
        router.push(loginHref(pathname));
        return;
      }
      if (!res.ok) {
        const err = await readError(res);
        pushToast('error', err.reason ?? t('action_failed'));
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { status?: string };
      pushToast('success', data.status === 'pending' ? t('join_requested', { name }) : t('join_done', { name }));
      setDialog(false);
      router.refresh();
    } catch {
      pushToast('error', t('action_failed'));
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/zones/${slug}/leave`, { method: 'POST' });
      if (res.status === 401) {
        pushToast('error', t('login_required'));
        router.push(loginHref(pathname));
        return;
      }
      if (!res.ok) {
        const err = await readError(res);
        pushToast('error', err.reason ?? t('action_failed'));
        return;
      }
      pushToast('success', t('leave_done', { name }));
      closeMenu();
      router.refresh();
    } catch {
      pushToast('error', t('action_failed'));
    } finally {
      setBusy(false);
    }
  }

  if (access.isOwner) {
    return <span className={PILL_INK}>{tl('zoneRole.owner')}</span>;
  }

  if (access.isMember) {
    if (!access.canLeave) return <span className={PILL_MONO}>{t('join_member_pill')}</span>;
    return (
      <>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => (menu ? closeMenu() : openPanel())}
          aria-haspopup="menu"
          aria-expanded={menu}
          aria-controls={menu ? menuId : undefined}
          className={BTN_SECONDARY}
        >
          <Check className="h-4 w-4" />
          {t('join_member_pill')}
          <ChevronDown
            className={`h-3.5 w-3.5 text-zinc-400 transition-transform duration-200 ${menu ? 'rotate-180' : ''}`}
          />
        </button>
        {host &&
          createPortal(
            <AnimatePresence>
              {menu && pos && (
                <motion.div
                  ref={panelRef}
                  id={menuId}
                  role="menu"
                  aria-label={t('join_member_pill')}
                  initial={{ opacity: 0, y: pos.up ? 4 : -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: pos.up ? 4 : -4 }}
                  transition={{ duration: 0.15 }}
                  // z-[70]: matches ZoneManageMenu — above the sticky NavBar
                  // (z-40), below dialogs (z-[80]+) and the PreviewDrawer.
                  className="surface fixed z-[70] w-56 overflow-y-auto overscroll-contain rounded-xl p-1 shadow-lg"
                  style={{ left: pos.left, top: pos.top, maxHeight: pos.maxHeight }}
                >
                  {access.roleName && (
                    <div className="px-3 py-2 text-xs text-muted">{t('join_role_hint', { role: access.roleName })}</div>
                  )}
                  {confirmLeave ? (
                    <div className="px-3 py-2">
                      <p className="text-xs text-zinc-600 dark:text-zinc-400">{t('leave_confirm', { name })}</p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={leave}
                          disabled={busy}
                          className={`${BTN_PRIMARY} h-8 px-3 text-xs`}
                        >
                          {t('leave_action')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmLeave(false)}
                          className={`${BTN_SECONDARY} h-8 px-3 text-xs`}
                        >
                          {t('cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      autoFocus
                      onClick={() => setConfirmLeave(true)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-700 outline-none transition hover:bg-zinc-100 focus-visible:bg-zinc-100 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zinc-400 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:focus-visible:bg-zinc-800 dark:focus-visible:ring-zinc-500"
                    >
                      <LogOut className="h-4 w-4" />
                      {t('leave_action')}
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>,
            host,
          )}
      </>
    );
  }

  if (access.membershipStatus === 'pending') {
    return (
      <span className={`${PILL_MONO} h-9 px-3`}>
        <Clock className="h-3.5 w-3.5" />
        {t('join_pending_pill')}
      </span>
    );
  }

  if (!access.canJoin) {
    return (
      <span className={`${PILL_MONO} h-9 px-3`}>
        <Lock className="h-3.5 w-3.5" />
        {joinPolicy === 'invite' ? t('join_invite_only') : t('join_unavailable')}
      </span>
    );
  }

  const approval = joinPolicy === 'approval';
  const cta = (
    <button
      type="button"
      onClick={() => (approval ? setDialog(true) : join(''))}
      disabled={busy}
      className={BTN_PRIMARY}
    >
      <UserPlus className="h-4 w-4" />
      {approval ? t('join_apply') : t('join_now')}
    </button>
  );

  return (
    <>
      {magnetic ? <Magnetic>{cta}</Magnetic> : cta}
      {dialog && (
        <JoinDialog
          name={name}
          busy={busy}
          onClose={() => setDialog(false)}
          onSubmit={(message) => join(message)}
        />
      )}
    </>
  );
}

function JoinDialog({
  name,
  busy,
  onClose,
  onSubmit,
}: {
  name: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (message: string) => void;
}) {
  const t = useTranslations('zones');
  const [message, setMessage] = useState('');
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <motion.form
        role="dialog"
        aria-modal="true"
        aria-label={t('join_dialog_title', { name })}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(message.trim());
        }}
        className="surface w-full max-w-md rounded-2xl p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{t('join_dialog_title', { name })}</h2>
            <p className="mt-1 text-xs text-muted">{t('join_dialog_hint')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('cancel')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, ZONE_LIMITS.joinMessageMax))}
          rows={4}
          autoFocus
          placeholder={t('join_dialog_placeholder')}
          className={`${TEXTAREA_CLS} mt-4`}
        />
        <div className="mt-1 text-right font-mono text-[11px] tabular-nums text-zinc-400">
          {message.length}/{ZONE_LIMITS.joinMessageMax}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>
            {t('cancel')}
          </button>
          <button type="submit" disabled={busy} className={BTN_PRIMARY}>
            {t('join_dialog_submit')}
          </button>
        </div>
      </motion.form>
    </div>,
    document.body,
  );
}
