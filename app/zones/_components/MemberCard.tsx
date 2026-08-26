'use client';

// 技术专区 — member card for the directory. Identity via the house contract
// (Avatar + DeptTag, no @handle text for private users). Manager actions ride
// PATCH/DELETE /members/[userId]; the owner row is untouchable (主版主 pill).

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Check, FileText, Loader2, MessageSquareQuote, Pencil, UserMinus, X } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { pushToast } from '@/components/Toaster';
import { relativeTime } from '@/lib/i18n-date';
import { ZONE_MEMBER_ROLE_KEY, canAssignZoneRole } from '@/lib/zones/permissions';
import { ZONE_LIMITS } from '@/lib/zones/shared';
import type { ZoneAccess, ZoneMemberView, ZoneRoleView } from '@/lib/zones/types';
import { BTN_DANGER, BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD_CLS, INPUT_CLS, PILL_INK, PILL_MONO, SELECT_CLS, readError } from './ui';

export function MemberCard({
  member,
  roles,
  access,
  zoneSlug,
  currentUserId,
  onChange,
  onRemove,
}: {
  member: ZoneMemberView;
  roles: ZoneRoleView[];
  access: ZoneAccess;
  zoneSlug: string;
  currentUserId: string | null;
  onChange: (next: ZoneMemberView) => void;
  onRemove: (userId: string) => void;
}) {
  const t = useTranslations('zones');
  const tl = useTranslations('labels');
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(member.title);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const isSelf = currentUserId != null && member.userId === currentUserId;
  const manageable = access.canManageMembers && !member.isOwner;
  const assignable = roles.filter((r) => canAssignZoneRole(access, r)).sort((a, b) => a.sortOrder - b.sortOrder);
  const currentRole = roles.find((r) => r.key === member.roleKey) ?? null;
  const roleLocked = !manageable || isSelf || (currentRole != null && !assignable.some((r) => r.id === currentRole.id));

  async function patch(body: Record<string, unknown>, okMessage: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    try {
      const res = await fetch(`/api/zones/${zoneSlug}/members/${member.userId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await readError(res);
        pushToast('error', err.reason ?? t('action_failed'));
        return false;
      }
      pushToast('success', okMessage);
      return true;
    } catch {
      pushToast('error', t('action_failed'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(roleId: string) {
    const role = roles.find((r) => r.id === roleId);
    if (!role) return;
    const ok = await patch(
      { roleId: role.key === ZONE_MEMBER_ROLE_KEY ? null : role.id },
      t('members_role_changed', { name: member.user.displayName, role: role.name }),
    );
    if (ok) onChange({ ...member, roleKey: role.key, roleName: role.name });
  }

  async function saveTitle() {
    const next = title.trim().slice(0, ZONE_LIMITS.memberTitleMax);
    if (next === member.title) {
      setEditingTitle(false);
      return;
    }
    const ok = await patch({ title: next }, t('members_title_saved'));
    if (ok) {
      onChange({ ...member, title: next });
      setEditingTitle(false);
    }
  }

  async function review(approve: boolean) {
    const ok = await patch(
      { status: approve ? 'active' : 'rejected' },
      approve ? t('members_approved', { name: member.user.displayName }) : t('members_rejected', { name: member.user.displayName }),
    );
    if (!ok) return;
    if (approve) onChange({ ...member, status: 'active', joinedAt: new Date().toISOString(), message: '' });
    else onRemove(member.userId);
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/zones/${zoneSlug}/members/${member.userId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await readError(res);
        pushToast('error', err.reason ?? t('action_failed'));
        return;
      }
      pushToast('success', t('members_removed', { name: member.user.displayName }));
      onRemove(member.userId);
    } catch {
      pushToast('error', t('action_failed'));
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  }

  return (
    <article className={`${CARD_CLS} card-hover flex h-full flex-col p-4`}>
      <div className="flex items-start gap-3">
        <Link href={`/users/${member.user.handle}`} className="shrink-0">
          <Avatar name={member.user.displayName} src={member.user.avatarUrl} size="lg" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link
              href={`/users/${member.user.handle}`}
              className="truncate text-sm font-semibold text-zinc-900 hover:underline dark:text-zinc-50"
            >
              {member.user.displayName}
            </Link>
            {isSelf && <span className="shrink-0 text-[11px] text-zinc-400">{t('members_you')}</span>}
          </div>
          {!member.user.isPrivate && <div className="truncate font-mono text-xs text-zinc-400">@{member.user.handle}</div>}
          <DeptTag department={member.user.department} lab={member.user.lab} className="mt-1" />
        </div>
        <span className={member.isOwner ? PILL_INK : PILL_MONO}>
          {member.isOwner ? tl('zoneRole.owner') : member.roleName}
        </span>
      </div>

      <div className="mt-3 min-h-[1.25rem] text-xs text-zinc-600 dark:text-zinc-400">
        {editingTitle ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveTitle();
            }}
            className="flex items-center gap-1.5"
          >
            <input
              value={title}
              maxLength={ZONE_LIMITS.memberTitleMax}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('members_title_placeholder')}
              className={`${INPUT_CLS} h-8`}
              autoFocus
            />
            <button type="submit" disabled={busy} aria-label={t('save')} className={`${BTN_GHOST} h-8 w-8 justify-center px-0`}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => {
                setTitle(member.title);
                setEditingTitle(false);
              }}
              aria-label={t('cancel')}
              className={`${BTN_GHOST} h-8 w-8 justify-center px-0`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </form>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            {member.title ? (
              <span className="italic">{member.title}</span>
            ) : (
              <span className="text-zinc-400">{t('members_no_title')}</span>
            )}
            {manageable && (
              <button
                type="button"
                onClick={() => setEditingTitle(true)}
                aria-label={t('members_set_title')}
                title={t('members_set_title')}
                className="text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </span>
        )}
      </div>

      {member.status === 'pending' && member.message && (
        <blockquote className="mt-3 flex gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <MessageSquareQuote className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
          <span className="min-w-0 whitespace-pre-wrap break-words">{member.message}</span>
        </blockquote>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="inline-flex items-center gap-1 font-mono tabular-nums" title={t('members_post_count')}>
          <FileText className="h-3 w-3" />
          {member.postCount}
        </span>
        <span className="tabular-nums">
          {member.status === 'pending'
            ? t('members_requested_at', { time: relativeTime(member.createdAt, locale) })
            : t('members_joined_at', { time: relativeTime(member.joinedAt ?? member.createdAt, locale) })}
        </span>
      </div>

      {member.status === 'pending' && access.canManageMembers && (
        <div className="mt-3 flex gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <button type="button" onClick={() => review(true)} disabled={busy} className={`${BTN_PRIMARY} h-8 flex-1 px-3 text-xs`}>
            <Check className="h-3.5 w-3.5" />
            {t('members_approve')}
          </button>
          <button type="button" onClick={() => review(false)} disabled={busy} className={`${BTN_SECONDARY} h-8 flex-1 px-3 text-xs`}>
            <X className="h-3.5 w-3.5" />
            {t('members_reject')}
          </button>
        </div>
      )}

      {member.status === 'active' && manageable && (
        <div className="mt-3 flex items-center gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <select
            value={currentRole?.id ?? ''}
            onChange={(e) => void changeRole(e.target.value)}
            disabled={busy || roleLocked}
            aria-label={t('members_assign_role')}
            className={`${SELECT_CLS} h-8 min-w-0 flex-1 text-xs`}
          >
            {currentRole && !assignable.some((r) => r.id === currentRole.id) && (
              <option value={currentRole.id}>{currentRole.name}</option>
            )}
            {assignable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {confirmRemove ? (
            <>
              <button type="button" onClick={remove} disabled={busy} className={`${BTN_DANGER} h-8 px-2.5 text-xs`}>
                {t('members_remove_confirm')}
              </button>
              <button type="button" onClick={() => setConfirmRemove(false)} className={`${BTN_GHOST} h-8 px-2 text-xs`}>
                {t('cancel')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              disabled={busy || isSelf}
              title={t('members_remove')}
              aria-label={t('members_remove')}
              className={`${BTN_GHOST} h-8 w-8 justify-center px-0`}
            >
              <UserMinus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </article>
  );
}
