'use client';

// 技术专区 — 创建版块 wizard on the motion Stepper: 基本信息 → 组织归属 → 权限与加入
// → 简介与链接 → 完成. The parent owns every draft field (Stepper unmounts the
// step content); slug auto-derives from the name until edited by hand;
// lab/department prefill from GET /api/zones/meta. POST /api/zones → push.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { RichTextEditor } from '@/components/RichTextEditor';
import { pushToast } from '@/components/Toaster';
import { Magnetic, Stepper } from '@/components/motion';
import { ZONE_LIMITS, isValidZoneSlug, slugifyAscii, zoneHref, type ZoneLink } from '@/lib/zones/shared';
import { AccessOptions, LinksField, type AccessValue } from './ZoneSettingsForm';
import { BTN_PRIMARY, BTN_SECONDARY, CARD_CLS, HINT_CLS, INPUT_CLS, LABEL_CLS, PILL_MONO, readError } from './ui';

interface ZoneMeta {
  labs: string[];
  departments: string[];
  canCreate: boolean;
  me: { lab: string; department: string };
}

export function CreateZoneWizard({ facets }: { facets: { labs: string[]; departments: string[] } }) {
  const t = useTranslations('zones');
  const tl = useTranslations('labels');
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [tagline, setTagline] = useState('');
  const [lab, setLab] = useState('');
  const [department, setDepartment] = useState('');
  const [orgTouched, setOrgTouched] = useState(false);
  const [access, setAccess] = useState<AccessValue>({ visibility: 'public', joinPolicy: 'approval', allowGuestComments: true });
  const [descriptionMd, setDescriptionMd] = useState('');
  const [links, setLinks] = useState<ZoneLink[]>([]);
  const [labs, setLabs] = useState(facets.labs);
  const [departments, setDepartments] = useState(facets.departments);
  const [busy, setBusy] = useState(false);
  const [slugError, setSlugError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/zones/meta');
        if (!res.ok) return;
        const meta = (await res.json()) as Partial<ZoneMeta>;
        if (cancelled) return;
        if (Array.isArray(meta.labs) && meta.labs.length) setLabs(meta.labs);
        if (Array.isArray(meta.departments) && meta.departments.length) setDepartments(meta.departments);
        if (meta.me && !orgTouched) {
          setLab((v) => v || meta.me?.lab || '');
          setDepartment((v) => v || meta.me?.department || '');
        }
      } catch {
        /* prefill is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onNameChange(v: string) {
    setName(v);
    if (!slugTouched) setSlug(slugifyAscii(v));
  }

  const trimmedName = name.trim();
  const nameOk = trimmedName.length >= ZONE_LIMITS.nameMin && trimmedName.length <= ZONE_LIMITS.nameMax;
  const slugOk = isValidZoneSlug(slug);
  const basicOk = nameOk && slugOk && tagline.length <= ZONE_LIMITS.taglineMax;

  const canNext = step === 0 ? basicOk : true;

  async function create() {
    if (busy || !basicOk) return;
    setBusy(true);
    setSlugError(null);
    try {
      const res = await fetch('/api/zones', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          slug,
          tagline: tagline.trim(),
          descriptionMd,
          lab: lab.trim(),
          department: department.trim(),
          visibility: access.visibility,
          joinPolicy: access.joinPolicy,
          allowGuestComments: access.allowGuestComments,
          links,
        }),
      });
      if (!res.ok) {
        const err = await readError(res);
        if (err.error === 'slug_taken') {
          setSlugError(t('create_slug_taken'));
          setStep(0);
          pushToast('error', t('create_slug_taken'));
          return;
        }
        pushToast('error', err.reason ?? t('action_failed'));
        return;
      }
      const data = (await res.json()) as { slug: string };
      pushToast('success', t('create_done', { name: trimmedName }));
      router.push(zoneHref(data.slug));
      router.refresh();
    } catch {
      pushToast('error', t('action_failed'));
    } finally {
      setBusy(false);
    }
  }

  const steps = [
    {
      key: 'basic',
      title: t('create_step_basic'),
      content: (
        <section className={`${CARD_CLS} space-y-4 p-4 sm:p-5`}>
          <div>
            <label className={LABEL_CLS}>{t('create_name')}</label>
            <input
              value={name}
              maxLength={ZONE_LIMITS.nameMax}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder={t('create_name_placeholder')}
              className={INPUT_CLS}
              autoFocus
            />
            <p className={HINT_CLS}>{t('create_name_hint', { min: ZONE_LIMITS.nameMin, max: ZONE_LIMITS.nameMax })}</p>
          </div>
          <div>
            <label className={LABEL_CLS}>{t('create_slug')}</label>
            <div className="flex items-center gap-2">
              <span className="shrink-0 font-mono text-xs text-zinc-400">/zones/</span>
              <input
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlugError(null);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-').slice(0, 40));
                }}
                placeholder={t('create_slug_placeholder')}
                className={`${INPUT_CLS} font-mono ${slug && !slugOk ? 'border-danger' : ''}`}
              />
            </div>
            <p className={`${HINT_CLS} ${slugError || (slug && !slugOk) ? 'text-danger' : ''}`}>
              {slugError ?? (slug && !slugOk ? t('create_slug_invalid') : t('create_slug_hint'))}
            </p>
          </div>
          <div>
            <label className={LABEL_CLS}>{t('create_tagline')}</label>
            <input
              value={tagline}
              maxLength={ZONE_LIMITS.taglineMax}
              onChange={(e) => setTagline(e.target.value)}
              placeholder={t('create_tagline_placeholder')}
              className={INPUT_CLS}
            />
            <p className={`${HINT_CLS} text-right font-mono tabular-nums`}>
              {tagline.length}/{ZONE_LIMITS.taglineMax}
            </p>
          </div>
        </section>
      ),
    },
    {
      key: 'org',
      title: t('create_step_org'),
      content: (
        <section className={`${CARD_CLS} space-y-4 p-4 sm:p-5`}>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('create_org_intro')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLS}>{t('create_lab')}</label>
              <input
                list="create-zone-labs"
                value={lab}
                maxLength={ZONE_LIMITS.labMax}
                onChange={(e) => {
                  setOrgTouched(true);
                  setLab(e.target.value);
                }}
                className={INPUT_CLS}
              />
              <datalist id="create-zone-labs">
                {labs.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={LABEL_CLS}>{t('create_department')}</label>
              <input
                list="create-zone-departments"
                value={department}
                maxLength={ZONE_LIMITS.departmentMax}
                onChange={(e) => {
                  setOrgTouched(true);
                  setDepartment(e.target.value);
                }}
                className={INPUT_CLS}
              />
              <datalist id="create-zone-departments">
                {departments.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>
          </div>
          <p className={HINT_CLS}>{t('create_org_hint')}</p>
        </section>
      ),
    },
    {
      key: 'access',
      title: t('create_step_access'),
      content: (
        <section className={`${CARD_CLS} p-4 sm:p-5`}>
          <AccessOptions value={access} onChange={setAccess} />
        </section>
      ),
    },
    {
      key: 'description',
      title: t('create_step_description'),
      content: (
        <section className={`${CARD_CLS} space-y-4 p-4 sm:p-5`}>
          <div>
            <label className={LABEL_CLS}>{t('create_description')}</label>
            <RichTextEditor
              value={descriptionMd}
              onChange={setDescriptionMd}
              placeholder={t('create_description_placeholder')}
              variant="full"
              maxLength={ZONE_LIMITS.descriptionMax}
              maxHeight={380}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>{t('create_links')}</label>
            <LinksField value={links} onChange={setLinks} />
          </div>
        </section>
      ),
    },
    {
      key: 'review',
      title: t('create_step_review'),
      content: (
        <section className={`${CARD_CLS} p-4 sm:p-5`}>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
            <dt className="text-zinc-500">{t('create_name')}</dt>
            <dd className="font-medium">{trimmedName}</dd>
            <dt className="text-zinc-500">{t('create_slug')}</dt>
            <dd className="font-mono">/zones/{slug}</dd>
            <dt className="text-zinc-500">{t('create_tagline')}</dt>
            <dd>{tagline.trim() || <span className="text-zinc-400">—</span>}</dd>
            <dt className="text-zinc-500">{t('create_step_org')}</dt>
            <dd className="flex flex-wrap gap-1.5">
              {[lab.trim(), department.trim()].filter(Boolean).length ? (
                [lab.trim(), department.trim()].filter(Boolean).map((v) => (
                  <span key={v} className={`${PILL_MONO} normal-case tracking-normal`}>
                    {v}
                  </span>
                ))
              ) : (
                <span className="text-zinc-400">—</span>
              )}
            </dd>
            <dt className="text-zinc-500">{t('create_step_access')}</dt>
            <dd className="flex flex-wrap gap-1.5">
              <span className={PILL_MONO}>{tl(`zoneVisibility.${access.visibility}`)}</span>
              <span className={PILL_MONO}>{tl(`zoneJoinPolicy.${access.joinPolicy}`)}</span>
              {access.visibility === 'public' && access.allowGuestComments && (
                <span className={PILL_MONO}>{t('access_guest_comments')}</span>
              )}
            </dd>
            <dt className="text-zinc-500">{t('create_links')}</dt>
            <dd className="font-mono text-xs tabular-nums">{links.length}</dd>
          </dl>
          <p className={`${HINT_CLS} mt-4`}>{t('create_review_hint')}</p>
        </section>
      ),
    },
  ];

  const last = step === steps.length - 1;

  return (
    <div>
      <Stepper steps={steps} step={step} onStepChange={setStep} />
      <div className="mt-6 flex items-center justify-between gap-3">
        <div>
          {step > 0 ? (
            <button type="button" onClick={() => setStep((s) => s - 1)} disabled={busy} className={BTN_SECONDARY}>
              <ArrowLeft className="h-4 w-4" />
              {t('create_back')}
            </button>
          ) : (
            <Link href="/zones" className={BTN_SECONDARY}>
              {t('cancel')}
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs tabular-nums text-zinc-400">
            {step + 1}/{steps.length}
          </span>
          {last ? (
            <Magnetic>
              <button type="button" onClick={create} disabled={busy || !basicOk} className={BTN_PRIMARY}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {t('create_submit')}
              </button>
            </Magnetic>
          ) : (
            <button type="button" onClick={() => canNext && setStep((s) => s + 1)} disabled={!canNext} className={BTN_PRIMARY}>
              {t('create_next')}
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <p className="sr-only">{steps[step].title}</p>
    </div>
  );
}
