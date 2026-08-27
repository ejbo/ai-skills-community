'use client';

// 技术专区 — 危险操作: 转让主版主 (active member picker → POST /transfer) and
// 删除版块 (type the slug to confirm → DELETE, soft). Owner or site admin only.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ArrowRightLeft, Loader2, Trash2 } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { pushToast } from '@/components/Toaster';
import { zoneHref } from '@/lib/zones/shared';
import type { ZoneAccess } from '@/lib/zones/types';
import { MemberPicker, type PickedUser } from './MemberPicker';
import { BTN_DANGER, BTN_SECONDARY, CARD_CLS, HINT_CLS, INPUT_CLS, LABEL_CLS, readError } from './ui';

export function DangerZone({
  zoneSlug,
  zoneName,
  access,
}: {
  zoneSlug: string;
  zoneName: string;
  access: ZoneAccess;
}) {
  const t = useTranslations('zones');
  const router = useRouter();
  const [picked, setPicked] = useState<PickedUser | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [confirmSlug, setConfirmSlug] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function transfer() {
    if (!picked || transferBusy) return;
    setTransferBusy(true);
    try {
      const res = await fetch(`/api/zones/${zoneSlug}/transfer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: picked.userId }),
      });
      if (!res.ok) {
        const err = await readError(res);
        pushToast('error', err.reason ?? t('action_failed'));
        return;
      }
      pushToast('success', t('danger_transfer_done', { name: picked.user.displayName }));
      router.push(zoneHref(zoneSlug));
      router.refresh();
    } catch {
      pushToast('error', t('action_failed'));
    } finally {
      setTransferBusy(false);
    }
  }

  async function remove() {
    if (deleteBusy || confirmSlug !== zoneSlug) return;
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/zones/${zoneSlug}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await readError(res);
        pushToast('error', err.reason ?? t('action_failed'));
        return;
      }
      pushToast('success', t('danger_delete_done', { name: zoneName }));
      router.push('/zones');
      router.refresh();
    } catch {
      pushToast('error', t('action_failed'));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className={`${CARD_CLS} p-4 sm:p-5`}>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ArrowRightLeft className="h-4 w-4 text-zinc-500" />
          {t('danger_transfer_title')}
        </h3>
        <p className={`${HINT_CLS} max-w-xl`}>{t('danger_transfer_desc')}</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <MemberPicker
            zoneSlug={zoneSlug}
            source="members"
            excludeUserIds={access.viewerId ? [access.viewerId] : []}
            onPick={setPicked}
            placeholder={t('danger_transfer_search')}
          />
          <div className="flex flex-col justify-between rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            {picked ? (
              <div className="flex items-center gap-3">
                <Avatar name={picked.user.displayName} src={picked.user.avatarUrl} size="lg" handle={picked.user.handle} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{picked.user.displayName}</div>
                  <DeptTag department={picked.user.department} lab={picked.user.lab} />
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted">{t('danger_transfer_pick_hint')}</p>
            )}
            <div className="mt-3 flex justify-end gap-2">
              {picked && (
                <button type="button" onClick={() => setPicked(null)} className={`${BTN_SECONDARY} h-8 px-3 text-xs`}>
                  {t('cancel')}
                </button>
              )}
              <button
                type="button"
                onClick={transfer}
                disabled={!picked || transferBusy || picked.membership === 'owner'}
                className={`${BTN_DANGER} h-8 px-3 text-xs`}
              >
                {transferBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t('danger_transfer_action')}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className={`${CARD_CLS} border-danger/40 p-4 sm:p-5`}>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-danger">
          <AlertTriangle className="h-4 w-4" />
          {t('danger_delete_title')}
        </h3>
        <p className={`${HINT_CLS} max-w-xl`}>{t('danger_delete_desc')}</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className={LABEL_CLS}>{t('danger_delete_confirm_label', { slug: zoneSlug })}</label>
            <input
              value={confirmSlug}
              onChange={(e) => setConfirmSlug(e.target.value.trim())}
              placeholder={zoneSlug}
              className={`${INPUT_CLS} font-mono`}
              autoComplete="off"
            />
          </div>
          <button type="button" onClick={remove} disabled={deleteBusy || confirmSlug !== zoneSlug} className={BTN_DANGER}>
            {deleteBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {t('danger_delete_action')}
          </button>
        </div>
      </section>
    </div>
  );
}
