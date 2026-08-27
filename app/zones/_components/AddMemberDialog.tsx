'use client';

// 技术专区 — 添加成员 dialog: MemberPicker (site users) + role select limited to
// what the actor may assign (canAssignZoneRole) → POST /members.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { Loader2, X } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { pushToast } from '@/components/Toaster';
import { ZONE_MEMBER_ROLE_KEY, canAssignZoneRole } from '@/lib/zones/permissions';
import type { ZoneAccess, ZoneMemberView, ZoneRoleView } from '@/lib/zones/types';
import { MemberPicker, type PickedUser } from './MemberPicker';
import { BTN_PRIMARY, BTN_SECONDARY, LABEL_CLS, SELECT_CLS, readError } from './ui';

export function AddMemberDialog({
  zoneSlug,
  roles,
  access,
  onClose,
  onAdded,
}: {
  zoneSlug: string;
  roles: ZoneRoleView[];
  access: ZoneAccess;
  onClose: () => void;
  onAdded: (member: ZoneMemberView) => void;
}) {
  const t = useTranslations('zones');
  const [picked, setPicked] = useState<PickedUser | null>(null);
  const assignable = roles.filter((r) => canAssignZoneRole(access, r)).sort((a, b) => a.sortOrder - b.sortOrder);
  const memberRole = assignable.find((r) => r.key === ZONE_MEMBER_ROLE_KEY) ?? null;
  const [roleId, setRoleId] = useState<string>(memberRole?.id ?? assignable[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

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

  async function submit() {
    if (!picked || busy) return;
    setBusy(true);
    try {
      const chosen = assignable.find((r) => r.id === roleId) ?? null;
      const res = await fetch(`/api/zones/${zoneSlug}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: picked.userId,
          roleId: chosen && chosen.key !== ZONE_MEMBER_ROLE_KEY ? chosen.id : null,
        }),
      });
      if (!res.ok) {
        const err = await readError(res);
        pushToast('error', err.reason ?? t('action_failed'));
        return;
      }
      const data = (await res.json()) as { member: ZoneMemberView };
      pushToast('success', t('members_added', { name: picked.user.displayName }));
      onAdded(data.member);
      onClose();
    } catch {
      pushToast('error', t('action_failed'));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="presentation">
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={t('members_add')}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="surface w-full max-w-lg rounded-2xl p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{t('members_add')}</h2>
            <p className="mt-1 text-xs text-muted">{t('members_add_hint')}</p>
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

        <div className="mt-4">
          {picked ? (
            <div className="flex items-center gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <Avatar name={picked.user.displayName} src={picked.user.avatarUrl} size="lg" handle={picked.user.handle} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{picked.user.displayName}</div>
                <DeptTag department={picked.user.department} lab={picked.user.lab} />
              </div>
              <button type="button" onClick={() => setPicked(null)} className={`${BTN_SECONDARY} h-8 px-3 text-xs`}>
                {t('members_pick_again')}
              </button>
            </div>
          ) : (
            <MemberPicker zoneSlug={zoneSlug} source="search" onPick={setPicked} autoFocus />
          )}
        </div>

        <div className="mt-4">
          <label className={LABEL_CLS}>{t('members_role')}</label>
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className={`${SELECT_CLS} w-full`}>
            {assignable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.key})
              </option>
            ))}
          </select>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>
            {t('cancel')}
          </button>
          <button type="button" onClick={submit} disabled={!picked || busy} className={BTN_PRIMARY}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('members_add_submit')}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
