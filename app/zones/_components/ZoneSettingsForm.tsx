'use client';

// 技术专区 — settings surface: TabBar (基本信息 | 权限与加入 | 栏目 | 角色 | 危险操作),
// each tab gated by the pre-decided ZoneAccess (settingsTabsFor). All tab drafts
// live in THIS component so a `?tab=` soft navigation keeps unsaved edits; the
// 栏目 tab is the exception — ColumnsEditor owns its list and re-reads the
// server after every mutation, so it seeds from `zone` and needs no draft here.
// It also gets `access.canManage`: the tab admits `moderate`, but its
// 允许成员自建栏目 switch PATCHes the zone row, which needs `manage`.
// `LinksField` and `AccessOptions` are exported for the create wizard.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ExternalLink, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { RichTextEditor } from '@/components/RichTextEditor';
import { pushToast } from '@/components/Toaster';
import { TabBar } from '@/components/motion';
import {
  MAX_ZONE_LINKS,
  ZONE_JOIN_POLICIES,
  ZONE_LIMITS,
  ZONE_VISIBILITIES,
  normalizeHttpUrl,
  zoneHref,
  type ZoneLink,
} from '@/lib/zones/shared';
import type { ZoneOrgOptions } from '@/lib/zones/queries';
import type { ZoneDetailView, ZoneJoinPolicyView, ZoneVisibilityView } from '@/lib/zones/types';
import { ColumnsEditor } from './ColumnsEditor';
import { DangerZone } from './DangerZone';
import { RolesEditor } from './RolesEditor';
import { ZoneCoverUploader } from './ZoneCoverUploader';
import { BTN_PRIMARY, BTN_SECONDARY, CARD_CLS, HINT_CLS, INPUT_CLS, LABEL_CLS, SELECT_CLS, readError } from './ui';
import { settingsTabsFor, type SettingsTab } from './settings-tabs';


// ── Links ─────────────────────────────────────────────────────────────────────

export function LinksField({ value, onChange }: { value: ZoneLink[]; onChange: (next: ZoneLink[]) => void }) {
  const t = useTranslations('zones');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');

  function add() {
    const normalized = normalizeHttpUrl(url);
    if (!normalized) {
      pushToast('error', t('links_invalid_url'));
      return;
    }
    if (value.length >= MAX_ZONE_LINKS) {
      pushToast('error', t('links_limit', { max: MAX_ZONE_LINKS }));
      return;
    }
    onChange([...value, { label: label.trim().slice(0, 40), url: normalized }]);
    setLabel('');
    setUrl('');
  }

  return (
    <div>
      <ul className="space-y-1.5">
        {value.map((l, i) => (
          <li key={`${l.url}-${i}`} className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm dark:border-zinc-800">
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{l.label || l.url}</span>
              {l.label && <span className="ml-2 font-mono text-xs text-zinc-400">{l.url}</span>}
            </span>
            <button
              type="button"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              aria-label={t('delete')}
              className="text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          value={label}
          maxLength={40}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('links_label_placeholder')}
          className={`${INPUT_CLS} sm:w-40`}
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="https://"
          className={`${INPUT_CLS} flex-1 font-mono`}
        />
        <button type="button" onClick={add} disabled={!url.trim() || value.length >= MAX_ZONE_LINKS} className={BTN_SECONDARY}>
          <Plus className="h-4 w-4" />
          {t('links_add')}
        </button>
      </div>
      <p className={HINT_CLS}>{t('links_hint', { count: value.length, max: MAX_ZONE_LINKS })}</p>
    </div>
  );
}

// ── Visibility / join policy option cards ─────────────────────────────────────

function OptionCards<T extends string>({
  name,
  options,
  value,
  onChange,
  label,
}: {
  name: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: (v: T) => { title: string; desc: string };
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
      {options.map((opt) => {
        const on = opt === value;
        const l = label(opt);
        return (
          <label
            key={opt}
            className={`flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2.5 transition ${
              on
                ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900'
                : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700'
            }`}
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name={name}
                checked={on}
                onChange={() => onChange(opt)}
                className="h-3.5 w-3.5 accent-zinc-900 dark:accent-zinc-100"
              />
              <span className="text-sm font-medium">{l.title}</span>
              <span className="ml-auto font-mono text-[10px] uppercase text-zinc-400">{opt}</span>
            </span>
            <span className="text-xs text-muted">{l.desc}</span>
          </label>
        );
      })}
    </div>
  );
}

export interface AccessValue {
  visibility: ZoneVisibilityView;
  joinPolicy: ZoneJoinPolicyView;
  allowGuestComments: boolean;
}

export function AccessOptions({ value, onChange }: { value: AccessValue; onChange: (next: AccessValue) => void }) {
  const t = useTranslations('zones');
  const tl = useTranslations('labels');
  return (
    <div className="space-y-5">
      <div>
        <label className={LABEL_CLS}>{t('access_visibility')}</label>
        <OptionCards
          name="visibility"
          options={ZONE_VISIBILITIES}
          value={value.visibility}
          onChange={(visibility) => onChange({ ...value, visibility })}
          label={(v) => ({ title: tl(`zoneVisibility.${v}`), desc: t(`access_visibility_${v}_desc`) })}
        />
      </div>
      <div>
        <label className={LABEL_CLS}>{t('access_join_policy')}</label>
        <OptionCards
          name="joinPolicy"
          options={ZONE_JOIN_POLICIES}
          value={value.joinPolicy}
          onChange={(joinPolicy) => onChange({ ...value, joinPolicy })}
          label={(v) => ({ title: tl(`zoneJoinPolicy.${v}`), desc: t(`access_join_${v}_desc`) })}
        />
      </div>
      <label
        className={`flex items-start gap-2.5 rounded-lg border border-zinc-200 px-3 py-2.5 dark:border-zinc-800 ${
          value.visibility === 'members' ? 'opacity-60' : ''
        }`}
      >
        <input
          type="checkbox"
          checked={value.allowGuestComments}
          disabled={value.visibility === 'members'}
          onChange={(e) => onChange({ ...value, allowGuestComments: e.target.checked })}
          className="mt-0.5 h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
        />
        <span>
          <span className="block text-sm font-medium">{t('access_guest_comments')}</span>
          <span className="block text-xs text-muted">{t('access_guest_comments_desc')}</span>
        </span>
      </label>
    </div>
  );
}

// ── 组织归属: 研究所 → 实验室 ──────────────────────────────────────────────────
//
// A 研究所 is COMPOSED OF 实验室, so these are two DEPENDENT selects, not two
// free-text boxes — free text is why three 版块 ended up with three spellings of
// the second level. The values are stored in the backwards-named columns
// (`Zone.lab` = 研究所, `Zone.department` = 实验室 — see lib/org.ts) and stay
// Chinese: only the LABELS are translated, never the org values.
//
// Two things keep it from becoming a whitelist, which lib/org.ts forbids:
//  • 「其他（手动输入）」 reveals a free-text box, because the configured tree is
//    half filled in and nobody may be blocked from creating a 版块 today; and
//  • a value that is not in the options is NEVER silently dropped — the field
//    switches itself into the custom box holding it, so an existing 版块 always
//    survives a settings round trip.

export interface OrgValue {
  /** `Zone.lab` — the 研究所. */
  lab: string;
  /** `Zone.department` — the 实验室. */
  department: string;
}

/** Sentinel option value; not a legal org name (they are stored verbatim). */
const ORG_OTHER = '__other__';

export function OrgFields({
  value,
  options,
  onChange,
  idPrefix,
}: {
  value: OrgValue;
  options: ZoneOrgOptions;
  onChange: (next: OrgValue) => void;
  idPrefix: string;
}) {
  const t = useTranslations('zones');
  const tl = useTranslations('labels');
  // Explicit 「其他」 picks. An off-tree VALUE forces custom mode on its own, so
  // this state only has to remember a deliberate choice made on an empty field.
  const [instituteOther, setInstituteOther] = useState(false);
  const [labOther, setLabOther] = useState(false);

  const institute = value.lab.trim();
  const lab = value.department.trim();
  const instituteCustom = instituteOther || (!!institute && !options.institutes.includes(institute));
  const labOptions = !instituteCustom && institute ? (options.labsByInstitute[institute] ?? []) : [];
  // No institute and no saved 实验室 ⇒ nothing to choose from yet: locked.
  const labMode: 'select' | 'custom' | 'locked' =
    labOther || instituteCustom || (lab && !labOptions.includes(lab))
      ? 'custom'
      : institute && labOptions.length
        ? 'select'
        : institute
          ? 'custom' // a configured 研究所 whose 实验室 are not filled in yet
          : 'locked';

  function pickInstitute(next: string) {
    if (next === ORG_OTHER) {
      setInstituteOther(true);
      setLabOther(false);
      onChange({ lab: '', department: '' });
      return;
    }
    setInstituteOther(false);
    setLabOther(false);
    // A 实验室 belongs to exactly one 研究所 — drop it unless the new one has it.
    const keep = lab && (options.labsByInstitute[next] ?? []).includes(lab) ? lab : '';
    onChange({ lab: next, department: keep });
  }

  function pickLab(next: string) {
    if (next === ORG_OTHER) {
      setLabOther(true);
      onChange({ ...value, department: '' });
      return;
    }
    setLabOther(false);
    onChange({ ...value, department: next });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL_CLS} htmlFor={`${idPrefix}-institute`}>
            {tl('orgInstitute')}
          </label>
          <select
            id={`${idPrefix}-institute`}
            value={instituteCustom ? ORG_OTHER : institute}
            onChange={(e) => pickInstitute(e.target.value)}
            className={`${SELECT_CLS} w-full`}
          >
            <option value="">{t('create_org_none')}</option>
            {options.institutes.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
            <option value={ORG_OTHER}>{t('create_org_other')}</option>
          </select>
          {instituteCustom && (
            <input
              value={value.lab}
              maxLength={ZONE_LIMITS.labMax}
              onChange={(e) => onChange({ lab: e.target.value, department: value.department })}
              placeholder={t('create_org_institute_placeholder')}
              className={`${INPUT_CLS} mt-2`}
              aria-label={tl('orgInstitute')}
            />
          )}
        </div>
        <div>
          <label className={LABEL_CLS} htmlFor={`${idPrefix}-lab`}>
            {tl('orgLab')}
          </label>
          {labMode === 'select' ? (
            <select
              id={`${idPrefix}-lab`}
              value={lab}
              onChange={(e) => pickLab(e.target.value)}
              className={`${SELECT_CLS} w-full`}
            >
              <option value="">{t('create_org_none')}</option>
              {labOptions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
              <option value={ORG_OTHER}>{t('create_org_other')}</option>
            </select>
          ) : (
            <>
              <input
                id={`${idPrefix}-lab`}
                list={`${idPrefix}-lab-list`}
                value={value.department}
                disabled={labMode === 'locked'}
                maxLength={ZONE_LIMITS.departmentMax}
                onChange={(e) => onChange({ ...value, department: e.target.value })}
                placeholder={labMode === 'locked' ? t('create_org_lab_needs_institute') : t('create_org_lab_placeholder')}
                className={INPUT_CLS}
              />
              <datalist id={`${idPrefix}-lab-list`}>
                {(labOptions.length ? labOptions : options.labs).map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </>
          )}
        </div>
      </div>
      <p className={HINT_CLS}>{t('create_org_hint')}</p>
    </div>
  );
}

// ── Settings form ─────────────────────────────────────────────────────────────

interface BasicDraft {
  name: string;
  tagline: string;
  lab: string;
  department: string;
  descriptionMd: string;
  links: ZoneLink[];
  cover: { key: string | null | undefined; url: string | null };
  icon: { key: string | null | undefined; url: string | null };
}

export function ZoneSettingsForm({
  zone,
  facets,
  tab,
}: {
  zone: ZoneDetailView;
  facets: ZoneOrgOptions;
  tab: SettingsTab;
}) {
  const t = useTranslations('zones');
  const router = useRouter();
  const tabs = settingsTabsFor(zone);
  const base = `${zoneHref(zone.slug)}/settings`;
  const tabItems = tabs.map((k) => ({ key: k, label: t(`settings_tab_${k}`), href: k === 'basic' ? base : `${base}?tab=${k}` }));

  // `key: undefined` = untouched (omit from PATCH); null = removed.
  const [basic, setBasic] = useState<BasicDraft>({
    name: zone.name,
    tagline: zone.tagline,
    lab: zone.lab,
    department: zone.department,
    descriptionMd: zone.descriptionMd,
    links: zone.links,
    cover: { key: undefined, url: zone.coverUrl },
    icon: { key: undefined, url: zone.iconUrl },
  });
  const [accessValue, setAccessValue] = useState<AccessValue>({
    visibility: zone.visibility,
    joinPolicy: zone.joinPolicy,
    allowGuestComments: zone.allowGuestComments,
  });
  const [busy, setBusy] = useState(false);

  async function send(body: Record<string, unknown>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    try {
      const res = await fetch(`/api/zones/${zone.slug}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await readError(res);
        pushToast('error', err.reason ?? t('action_failed'));
        return false;
      }
      pushToast('success', t('saved'));
      router.refresh();
      return true;
    } catch {
      pushToast('error', t('action_failed'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveBasic(e: React.FormEvent) {
    e.preventDefault();
    const name = basic.name.trim();
    if (name.length < ZONE_LIMITS.nameMin || name.length > ZONE_LIMITS.nameMax) {
      pushToast('error', t('create_name_invalid', { min: ZONE_LIMITS.nameMin, max: ZONE_LIMITS.nameMax }));
      return;
    }
    const body: Record<string, unknown> = {
      name,
      tagline: basic.tagline.trim(),
      lab: basic.lab.trim(),
      department: basic.department.trim(),
      descriptionMd: basic.descriptionMd,
      links: basic.links,
    };
    if (basic.cover.key !== undefined) body.coverKey = basic.cover.key;
    if (basic.icon.key !== undefined) body.iconKey = basic.icon.key;
    const ok = await send(body);
    if (ok) setBasic((b) => ({ ...b, cover: { ...b.cover, key: undefined }, icon: { ...b.icon, key: undefined } }));
  }

  async function saveAccess(e: React.FormEvent) {
    e.preventDefault();
    await send({ ...accessValue });
  }

  const active: SettingsTab = tabs.includes(tab) ? tab : tabs[0];

  return (
    <div>
      <TabBar tabs={tabItems} active={active} id={`zone-settings-${zone.slug}`} />

      <div className="mt-6">
        {active === 'basic' && (
          <form onSubmit={saveBasic} className="space-y-6">
            <section className={`${CARD_CLS} space-y-4 p-4 sm:p-5`}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={LABEL_CLS}>{t('create_name')}</label>
                  <input
                    value={basic.name}
                    maxLength={ZONE_LIMITS.nameMax}
                    onChange={(e) => setBasic((b) => ({ ...b, name: e.target.value }))}
                    className={INPUT_CLS}
                    required
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>{t('create_slug')}</label>
                  <input value={zone.slug} readOnly className={`${INPUT_CLS} cursor-not-allowed font-mono opacity-70`} />
                  <p className={HINT_CLS}>{t('settings_slug_readonly')}</p>
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>{t('create_tagline')}</label>
                <input
                  value={basic.tagline}
                  maxLength={ZONE_LIMITS.taglineMax}
                  onChange={(e) => setBasic((b) => ({ ...b, tagline: e.target.value }))}
                  placeholder={t('create_tagline_placeholder')}
                  className={INPUT_CLS}
                />
              </div>
              <OrgFields
                value={{ lab: basic.lab, department: basic.department }}
                options={facets}
                onChange={(org) => setBasic((b) => ({ ...b, lab: org.lab, department: org.department }))}
                idPrefix={`zone-org-${zone.slug}`}
              />
            </section>

            <section className={`${CARD_CLS} grid gap-5 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-5`}>
              <div>
                <label className={LABEL_CLS}>{t('settings_cover')}</label>
                <ZoneCoverUploader
                  zoneSlug={zone.slug}
                  kind="cover"
                  url={basic.cover.url}
                  onChange={(next) => setBasic((b) => ({ ...b, cover: next }))}
                  disabled={busy}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>{t('settings_icon')}</label>
                <ZoneCoverUploader
                  zoneSlug={zone.slug}
                  kind="icon"
                  url={basic.icon.url}
                  onChange={(next) => setBasic((b) => ({ ...b, icon: next }))}
                  disabled={busy}
                />
              </div>
            </section>

            <section className={`${CARD_CLS} space-y-4 p-4 sm:p-5`}>
              <div>
                <label className={LABEL_CLS}>{t('create_description')}</label>
                <RichTextEditor
                  value={basic.descriptionMd}
                  onChange={(md) => setBasic((b) => ({ ...b, descriptionMd: md }))}
                  placeholder={t('create_description_placeholder')}
                  variant="full"
                  maxLength={ZONE_LIMITS.descriptionMax}
                  maxHeight={420}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>{t('create_links')}</label>
                <LinksField value={basic.links} onChange={(links) => setBasic((b) => ({ ...b, links }))} />
              </div>
            </section>

            <div className="flex justify-end">
              <button type="submit" disabled={busy} className={BTN_PRIMARY}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t('save')}
              </button>
            </div>
          </form>
        )}

        {active === 'access' && (
          <form onSubmit={saveAccess} className="space-y-6">
            <section className={`${CARD_CLS} p-4 sm:p-5`}>
              <AccessOptions value={accessValue} onChange={setAccessValue} />
            </section>
            <div className="flex justify-end">
              <button type="submit" disabled={busy} className={BTN_PRIMARY}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t('save')}
              </button>
            </div>
          </form>
        )}

        {active === 'columns' && (
          <ColumnsEditor
            zoneSlug={zone.slug}
            initialColumns={zone.columns}
            initialAllowMemberColumns={zone.allowMemberColumns}
            postCount={zone.postCount}
            canManage={zone.access.canManage}
          />
        )}

        {active === 'roles' && <RolesEditor zoneSlug={zone.slug} initialRoles={zone.roles} />}

        {active === 'danger' && <DangerZone zoneSlug={zone.slug} zoneName={zone.name} access={zone.access} />}
      </div>
    </div>
  );
}
