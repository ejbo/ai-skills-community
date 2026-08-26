'use client';

// 技术专区 — 角色 tab: every ZoneRole with permission checkboxes from the code
// catalog (ZONE_PERMISSIONS keys; display strings are i18n `roles_perm_*`),
// rename / describe, add a custom role, delete custom roles. System roles keep
// their key; `member` (the implicit default) may change permissions but never
// be deleted. Gated by canManageRoles at the page.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, Plus, Save, Trash2, Users } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { LiveList } from '@/components/motion';
import {
  ZONE_PERMISSION_KEYS,
  ZONE_ROLE_KEY_RE,
  normalizeZonePermissions,
  type ZonePermissionKey,
} from '@/lib/zones/permissions';
import { ZONE_LIMITS } from '@/lib/zones/shared';
import type { ZoneRoleView } from '@/lib/zones/types';
import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, CARD_CLS, HINT_CLS, INPUT_CLS, LABEL_CLS, PILL_INK, PILL_MONO, readError } from './ui';

interface RoleDraft {
  name: string;
  description: string;
  permissions: ZonePermissionKey[];
}

function draftOf(r: ZoneRoleView): RoleDraft {
  return { name: r.name, description: r.description ?? '', permissions: normalizeZonePermissions(r.permissions) };
}

function samePerms(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k) => b.includes(k));
}

export function RolesEditor({ zoneSlug, initialRoles }: { zoneSlug: string; initialRoles: ZoneRoleView[] }) {
  const t = useTranslations('zones');
  const router = useRouter();
  const [roles, setRoles] = useState<ZoneRoleView[]>(initialRoles);
  const [adding, setAdding] = useState(false);
  const customCount = roles.filter((r) => !r.isSystem).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-sm text-zinc-600 dark:text-zinc-400">{t('roles_intro')}</p>
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={adding || customCount >= ZONE_LIMITS.maxCustomRoles}
          className={BTN_PRIMARY}
        >
          <Plus className="h-4 w-4" />
          {t('roles_add')}
        </button>
      </div>

      {adding && (
        <NewRoleForm
          zoneSlug={zoneSlug}
          onCancel={() => setAdding(false)}
          onCreated={(role) => {
            setRoles((rs) => [...rs, role].sort((a, b) => a.sortOrder - b.sortOrder));
            setAdding(false);
            router.refresh();
          }}
        />
      )}

      <LiveList
        items={roles}
        keyOf={(r) => r.id}
        className="space-y-4"
        render={(role) => (
          <RoleCard
            zoneSlug={zoneSlug}
            role={role}
            onSaved={(next) => setRoles((rs) => rs.map((r) => (r.id === next.id ? next : r)))}
            onDeleted={(id) => {
              setRoles((rs) => rs.filter((r) => r.id !== id));
              router.refresh();
            }}
          />
        )}
      />
      <p className={HINT_CLS}>{t('roles_limit_hint', { count: customCount, max: ZONE_LIMITS.maxCustomRoles })}</p>
    </div>
  );
}

function PermissionGrid({
  value,
  onChange,
  disabled = false,
}: {
  value: ZonePermissionKey[];
  onChange: (next: ZonePermissionKey[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('zones');
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {ZONE_PERMISSION_KEYS.map((key) => {
        const on = value.includes(key);
        return (
          <label
            key={key}
            className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition ${
              on
                ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900'
                : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700'
            } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            <input
              type="checkbox"
              checked={on}
              disabled={disabled}
              onChange={(e) =>
                onChange(
                  normalizeZonePermissions(e.target.checked ? [...value, key] : value.filter((k) => k !== key)),
                )
              }
              className="mt-0.5 h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                {t(`roles_perm_${key}`)}
                <span className="font-mono text-[10px] uppercase text-zinc-400">{key}</span>
              </span>
              <span className="block text-xs text-muted">{t(`roles_perm_${key}_desc`)}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function RoleCard({
  zoneSlug,
  role,
  onSaved,
  onDeleted,
}: {
  zoneSlug: string;
  role: ZoneRoleView;
  onSaved: (next: ZoneRoleView) => void;
  onDeleted: (id: string) => void;
}) {
  const t = useTranslations('zones');
  const tl = useTranslations('labels');
  const [draft, setDraft] = useState<RoleDraft>(() => draftOf(role));
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const dirty =
    draft.name.trim() !== role.name ||
    draft.description.trim() !== (role.description ?? '') ||
    !samePerms(draft.permissions, role.permissions);

  async function save() {
    if (busy || !dirty) return;
    const name = draft.name.trim();
    if (!name) {
      pushToast('error', t('roles_name_required'));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/zones/${zoneSlug}/roles/${role.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, description: draft.description.trim(), permissions: draft.permissions }),
      });
      if (!res.ok) {
        const err = await readError(res);
        pushToast('error', err.reason ?? t('action_failed'));
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { role?: ZoneRoleView };
      const next: ZoneRoleView = data.role ?? { ...role, name, description: draft.description.trim(), permissions: draft.permissions };
      setDraft(draftOf(next));
      onSaved(next);
      pushToast('success', t('saved'));
    } catch {
      pushToast('error', t('action_failed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/zones/${zoneSlug}/roles/${role.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await readError(res);
        pushToast('error', err.reason ?? t('action_failed'));
        return;
      }
      pushToast('success', t('roles_deleted', { name: role.name }));
      onDeleted(role.id);
    } catch {
      pushToast('error', t('action_failed'));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  const systemLabel = role.isSystem ? tl(`zoneRole.${role.key}`) : null;

  return (
    <section className={`${CARD_CLS} p-4 sm:p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row">
          <div className="min-w-0 flex-1">
            <label className={LABEL_CLS}>{t('roles_name')}</label>
            <input
              value={draft.name}
              maxLength={ZONE_LIMITS.roleNameMax}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className={INPUT_CLS}
            />
          </div>
          <div className="min-w-0 flex-[2]">
            <label className={LABEL_CLS}>{t('roles_description')}</label>
            <input
              value={draft.description}
              maxLength={ZONE_LIMITS.roleDescriptionMax}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder={t('roles_description_placeholder')}
              className={INPUT_CLS}
            />
          </div>
        </div>
        <div className="flex items-center gap-1.5 pt-6">
          <span className={role.isSystem ? PILL_INK : PILL_MONO}>{role.key}</span>
          {systemLabel && <span className={PILL_MONO}>{t('roles_system')}</span>}
          <span className={`${PILL_MONO} normal-case tracking-normal`}>
            <Users className="h-3 w-3" />
            {role.memberCount}
          </span>
        </div>
      </div>

      <div className="mt-4">
        <label className={LABEL_CLS}>{t('roles_permissions')}</label>
        <PermissionGrid value={draft.permissions} onChange={(permissions) => setDraft((d) => ({ ...d, permissions }))} />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <div>
          {!role.isSystem &&
            (confirm ? (
              <span className="inline-flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                {t('roles_delete_confirm', { name: role.name, count: role.memberCount })}
                <button type="button" onClick={remove} disabled={busy} className={`${BTN_DANGER} h-8 px-3 text-xs`}>
                  {t('delete')}
                </button>
                <button type="button" onClick={() => setConfirm(false)} className={`${BTN_SECONDARY} h-8 px-3 text-xs`}>
                  {t('cancel')}
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirm(true)} disabled={busy} className={`${BTN_DANGER} h-8 px-3 text-xs`}>
                <Trash2 className="h-3.5 w-3.5" />
                {t('roles_delete')}
              </button>
            ))}
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <button type="button" onClick={() => setDraft(draftOf(role))} disabled={busy} className={`${BTN_SECONDARY} h-8 px-3 text-xs`}>
              {t('reset')}
            </button>
          )}
          <button type="button" onClick={save} disabled={busy || !dirty} className={`${BTN_PRIMARY} h-8 px-3 text-xs`}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {t('save')}
          </button>
        </div>
      </div>
    </section>
  );
}

function NewRoleForm({
  zoneSlug,
  onCancel,
  onCreated,
}: {
  zoneSlug: string;
  onCancel: () => void;
  onCreated: (role: ZoneRoleView) => void;
}) {
  const t = useTranslations('zones');
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<ZonePermissionKey[]>(['comment']);
  const [busy, setBusy] = useState(false);
  const keyOk = ZONE_ROLE_KEY_RE.test(key);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!keyOk) {
      pushToast('error', t('roles_key_invalid'));
      return;
    }
    if (!name.trim()) {
      pushToast('error', t('roles_name_required'));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/zones/${zoneSlug}/roles`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, name: name.trim(), description: description.trim(), permissions }),
      });
      if (!res.ok) {
        const err = await readError(res);
        pushToast('error', err.reason ?? (err.error === 'role_key_taken' ? t('roles_key_taken') : t('action_failed')));
        return;
      }
      const data = (await res.json()) as { role: ZoneRoleView };
      pushToast('success', t('roles_created', { name: data.role.name }));
      onCreated(data.role);
    } catch {
      pushToast('error', t('action_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={`${CARD_CLS} border-dashed p-4 sm:p-5`}>
      <h3 className="text-sm font-semibold">{t('roles_new_title')}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label className={LABEL_CLS}>{t('roles_key')}</label>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value.toLowerCase())}
            placeholder="reviewer"
            className={`${INPUT_CLS} font-mono`}
            autoFocus
          />
          <p className={HINT_CLS}>{t('roles_key_hint')}</p>
        </div>
        <div>
          <label className={LABEL_CLS}>{t('roles_name')}</label>
          <input value={name} maxLength={ZONE_LIMITS.roleNameMax} onChange={(e) => setName(e.target.value)} className={INPUT_CLS} />
        </div>
        <div>
          <label className={LABEL_CLS}>{t('roles_description')}</label>
          <input
            value={description}
            maxLength={ZONE_LIMITS.roleDescriptionMax}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('roles_description_placeholder')}
            className={INPUT_CLS}
          />
        </div>
      </div>
      <div className="mt-4">
        <label className={LABEL_CLS}>{t('roles_permissions')}</label>
        <PermissionGrid value={permissions} onChange={setPermissions} />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={BTN_SECONDARY}>
          {t('cancel')}
        </button>
        <button type="submit" disabled={busy || !keyOk || !name.trim()} className={BTN_PRIMARY}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('roles_create')}
        </button>
      </div>
    </form>
  );
}
