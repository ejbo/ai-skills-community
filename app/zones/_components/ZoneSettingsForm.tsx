'use client';

// 技术专区 — settings surface: TabBar (基本信息 | 权限与加入 | 栏目 | 主页布局 | 角色 | 危险操作),
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
import { withBasePath } from '@/lib/base-path';
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
import { SidebarLayoutEditor } from './SidebarLayoutEditor';
import { TopicsField } from './TopicsField';
import { ZoneCoverUploader } from './ZoneCoverUploader';
import { BTN_PRIMARY, BTN_SECONDARY, CARD_CLS, HINT_CLS, INPUT_CLS, LABEL_CLS, SELECT_CLS, chipCls, readError } from './ui';
import { ThemeColorPicker } from './ThemeColorPicker';
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
// Two modes, decided by whether 管理后台 → 技术专区 → 组织架构 has entries
// (`options.configured`):
//   • CATALOG: two <select>s — 研究所 (catalog order) then 实验室 (that
//     研究所's catalog labs, disabled until one is chosen). Each ends with a
//     「其他 / 自行填写」 option that reveals the free-text input below, so a
//     value outside the catalog still works — and a board whose STORED value is
//     not in the catalog opens in that state with its value intact (the picker
//     may never silently clear what a 版主 wrote).
//   • COMBOBOX (catalog empty): the 2026-09-11 behaviour — free text with
//     datalist suggestions from live 版块 ∪ the employee roster.
//
// The values are stored in the backwards-named columns (`Zone.lab` = 研究所,
// `Zone.department` = 实验室 — see lib/org.ts) and stay Chinese: only the
// LABELS are translated, never the org values.

export interface OrgValue {
  /** `Zone.lab` — the 研究所. */
  lab: string;
  /** `Zone.department` — the 实验室. */
  department: string;
}

/** The `<option>` value that switches a select into free-text mode; can never collide with a real name (names are trimmed, non-empty). */
const OTHER = '\u0000other';

function ComboInput({
  id,
  listId,
  value,
  maxLength,
  placeholder,
  suggestions,
  onChange,
}: {
  id: string;
  listId: string;
  value: string;
  maxLength: number;
  placeholder: string;
  suggestions: string[];
  onChange: (v: string) => void;
}) {
  return (
    <>
      <input
        id={id}
        list={listId}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className={INPUT_CLS}
      />
      <datalist id={listId}>
        {suggestions.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
    </>
  );
}

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
  const institute = value.lab.trim();
  const lab = value.department.trim();
  const catalog = options.configured ?? { institutes: [], labsByInstitute: {} };
  const hasCatalog = catalog.institutes.length > 0;
  const scoped = institute ? (options.labsByInstitute[institute] ?? []) : [];
  const labSuggestions = scoped.length > 0 ? scoped : options.labs;

  // 「其他」 is sticky: once chosen it stays open even while the text is empty,
  // and a stored value outside the catalog forces it open on first render.
  const [instituteOther, setInstituteOther] = useState(() => hasCatalog && Boolean(institute) && !catalog.institutes.includes(institute));
  const [labOther, setLabOther] = useState(() => {
    if (!hasCatalog || !lab) return false;
    const inCatalog = catalog.institutes.includes(institute) && (catalog.labsByInstitute[institute] ?? []).includes(lab);
    return !inCatalog;
  });

  if (!hasCatalog) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL_CLS} htmlFor={`${idPrefix}-institute`}>
              {tl('orgInstitute')}
            </label>
            <ComboInput
              id={`${idPrefix}-institute`}
              listId={`${idPrefix}-institute-list`}
              value={value.lab}
              maxLength={ZONE_LIMITS.labMax}
              placeholder={t('create_org_institute_placeholder')}
              suggestions={options.institutes}
              onChange={(v) => onChange({ lab: v, department: value.department })}
            />
          </div>
          <div>
            <label className={LABEL_CLS} htmlFor={`${idPrefix}-lab`}>
              {tl('orgLab')}
            </label>
            <ComboInput
              id={`${idPrefix}-lab`}
              listId={`${idPrefix}-lab-list`}
              value={value.department}
              maxLength={ZONE_LIMITS.departmentMax}
              placeholder={t('create_org_lab_placeholder')}
              suggestions={labSuggestions}
              onChange={(v) => onChange({ ...value, department: v })}
            />
          </div>
        </div>
        {options.institutes.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-zinc-400">{t('create_org_existing')}</span>
            {options.institutes.slice(0, 8).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onChange({ lab: v, department: value.department })}
                className={chipCls(institute === v)}
              >
                {v}
              </button>
            ))}
          </div>
        )}
        <p className={HINT_CLS}>{t('create_org_hint')}</p>
      </div>
    );
  }

  const instituteInCatalog = catalog.institutes.includes(institute);
  const instituteSelect = instituteOther ? OTHER : instituteInCatalog ? institute : '';
  const catalogLabs = instituteInCatalog ? (catalog.labsByInstitute[institute] ?? []) : [];
  const labInCatalog = catalogLabs.includes(lab);
  const labSelect = labOther ? OTHER : labInCatalog ? lab : '';
  // The 实验室 select needs a 研究所 first: a catalog one has its labs; an
  // 「其他」 研究所 has none, so only 「其他」 remains meaningful there.
  const labDisabled = !instituteOther && !instituteInCatalog;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label className={LABEL_CLS} htmlFor={`${idPrefix}-institute-select`}>
            {tl('orgInstitute')}
          </label>
          <select
            id={`${idPrefix}-institute-select`}
            value={instituteSelect}
            onChange={(e) => {
              const v = e.target.value;
              if (v === OTHER) {
                setInstituteOther(true);
                // Leaving the catalog: a catalog 实验室 no longer applies.
                if (labInCatalog) onChange({ lab: '', department: '' });
                else onChange({ lab: '', department: value.department });
                return;
              }
              setInstituteOther(false);
              setLabOther(false);
              // Switching 研究所 clears a 实验室 that belonged to the old one.
              const keep = (catalog.labsByInstitute[v] ?? []).includes(lab) ? value.department : '';
              onChange({ lab: v, department: keep });
            }}
            className={`${SELECT_CLS} w-full`}
          >
            <option value="">{t('create_org_pick_institute')}</option>
            {catalog.institutes.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
            <option value={OTHER}>{t('create_org_other')}</option>
          </select>
          {instituteOther && (
            <ComboInput
              id={`${idPrefix}-institute`}
              listId={`${idPrefix}-institute-list`}
              value={value.lab}
              maxLength={ZONE_LIMITS.labMax}
              placeholder={t('create_org_institute_placeholder')}
              suggestions={options.institutes.filter((v) => !catalog.institutes.includes(v))}
              onChange={(v) => onChange({ lab: v, department: value.department })}
            />
          )}
        </div>
        <div className="space-y-2">
          <label className={LABEL_CLS} htmlFor={`${idPrefix}-lab-select`}>
            {tl('orgLab')}
          </label>
          <select
            id={`${idPrefix}-lab-select`}
            value={labSelect}
            disabled={labDisabled}
            onChange={(e) => {
              const v = e.target.value;
              if (v === OTHER) {
                setLabOther(true);
                onChange({ ...value, department: labInCatalog ? '' : value.department });
                return;
              }
              setLabOther(false);
              onChange({ ...value, department: v });
            }}
            className={`${SELECT_CLS} w-full`}
          >
            <option value="">{labDisabled ? t('create_org_pick_lab_first') : t('create_org_pick_lab')}</option>
            {catalogLabs.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
            <option value={OTHER}>{t('create_org_other')}</option>
          </select>
          {labOther && !labDisabled && (
            <ComboInput
              id={`${idPrefix}-lab`}
              listId={`${idPrefix}-lab-list`}
              value={value.department}
              maxLength={ZONE_LIMITS.departmentMax}
              placeholder={t('create_org_lab_placeholder')}
              suggestions={labSuggestions.filter((v) => !catalogLabs.includes(v))}
              onChange={(v) => onChange({ ...value, department: v })}
            />
          )}
        </div>
      </div>
      <p className={HINT_CLS}>{t('create_org_catalog_hint')}</p>
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
  topics: string[];
  themeColor: string | null;
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
    topics: zone.topics,
    themeColor: zone.themeColor,
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
      topics: basic.topics,
      themeColor: basic.themeColor,
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
              <TopicsField
                value={basic.topics}
                onChange={(topics) => setBasic((b) => ({ ...b, topics }))}
                disabled={busy}
                idPrefix={`zone-topics-${zone.slug}`}
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
              <div className="sm:col-span-2">
                <ThemeColorPicker
                  value={basic.themeColor}
                  name={basic.name}
                  iconUrl={basic.icon.url ? withBasePath(basic.icon.url) : null}
                  onChange={(themeColor) => setBasic((b) => ({ ...b, themeColor }))}
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

        {active === 'layout' && <SidebarLayoutEditor zoneSlug={zone.slug} initial={zone.sidebar} />}

        {active === 'roles' && <RolesEditor zoneSlug={zone.slug} initialRoles={zone.roles} />}

        {active === 'danger' && <DangerZone zoneSlug={zone.slug} zoneName={zone.name} access={zone.access} />}
      </div>
    </div>
  );
}
