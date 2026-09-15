'use client';

// 设置 → 个人资料. Everything a visitor reads about the member on the merged
// profile page, edited in one place and saved with ONE 保存:
//
//   PUT /api/auth/me       {displayName, bio, avatarUrl}            (User row)
//   PUT /api/me/profile    {headline, aboutMd, interests, links, bannerUrl}  (UserProfile)
//
// Only CHANGED fields are sent, per endpoint, and an endpoint with nothing to
// say is skipped: a legacy avatar URL the hardened /api/auth/me would now
// refuse must not block someone who only edited their 头衔. The two calls are
// independent, so each one's success advances its own baseline — a partial
// failure never marks unsaved edits as saved.
//
// Media URLs stay root-relative in state; withBasePath() only at render.
//
// 头像 / 主页背景图 are public files, so a still photo is re-encoded in the browser
// before upload (./_components/strip-image.ts: EXIF/GPS dropped, orientation
// baked in); one the browser cannot decode is refused, never sent raw. A save
// drops this tab's cached hover card of the member (name / avatar / 头衔 changed).

import { useCallback, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { ArrowRight, IdCard, ImagePlus, Loader2, Trash2, Upload } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { Avatar } from '@/components/Avatar';
import { invalidateUserCard } from '@/components/user/UserHoverCard';
import { identityColor } from '@/lib/identity-color';
import { RichTextEditor } from '@/components/RichTextEditor';
import { HairlineGrid } from '@/components/motion/HairlineGrid';
import { withBasePath } from '@/lib/base-path';
import {
  ABOUT_MAX,
  HEADLINE_MAX,
  MAX_INTERESTS,
  MAX_LINKS,
  cardPalette,
  sanitizeAbout,
  sliceCodePoints,
  type ProfileLink,
} from '@/lib/profile/shared';
import type { OwnProfileSettings } from '@/lib/profile/types';
import { ChipInput } from './_components/ChipInput';
import { LinksEditor, newLinkRowId } from './_components/LinksEditor';
import { SaveBar } from './_components/SaveBar';
import { SettingsSection } from './_components/SettingsSection';
import {
  IMAGE_ACCEPT,
  codePointLength,
  linkRowState,
  linksForSave,
  photoFormatOf,
  shouldStripImage,
  type LinkRow,
} from './_components/editor-shared';
import { stripImageMetadata } from './_components/strip-image';
import { useUnsavedGuard } from './_components/useUnsavedGuard';
import { BTN_SECONDARY, COUNTER_CLS, HINT_CLS, INPUT_CLS, LABEL_CLS, TEXTAREA_CLS } from './_components/ui';

interface AccountUser {
  handle: string;
  email: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  authMethod: 'password' | 'huawei_sso' | 'both';
  huaweiW3Id: string | null;
  huaweiW3Name: string | null;
}

/** Mirrors /api/uploads/image (MAX_IMAGE_BYTES in lib/uploads/image-storage.ts — server-only module). */
const UPLOAD_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** /api/auth/me caps (zod): displayName 2–64, bio ≤ 240 (UTF-16 units, like the textarea's maxLength). */
const NAME_MIN = 2;
const NAME_MAX = 64;
const BIO_MAX = 240;

interface Baseline {
  displayName: string;
  bio: string;
  avatarUrl: string;
  headline: string;
  aboutMd: string;
  interests: string[];
  links: ProfileLink[];
  bannerUrl: string;
}

function rowsFrom(links: ProfileLink[]): LinkRow[] {
  return links.map((l) => ({ id: newLinkRowId(), label: l.label, url: l.url }));
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
/** Blank rows are not a change (the save drops them), so they never make the form dirty. */
const sameRows = (rows: readonly LinkRow[], links: readonly ProfileLink[]) => {
  const filled = rows.filter((r) => linkRowState(r) !== 'empty');
  return filled.length === links.length && filled.every((r, i) => r.label === links[i].label && r.url === links[i].url);
};

export function ProfileForm({ user, settings }: { user: AccountUser; settings: OwnProfileSettings }) {
  const t = useTranslations('settings');
  const router = useRouter();
  const { update } = useSession();
  const formId = useId();

  const [base, setBase] = useState<Baseline>(() => ({
    displayName: user.displayName,
    bio: user.bio ?? '',
    avatarUrl: user.avatarUrl ?? '',
    headline: settings.headline,
    aboutMd: settings.aboutMd,
    interests: settings.interests,
    links: settings.links,
    bannerUrl: settings.bannerUrl ?? '',
  }));

  const [displayName, setDisplayName] = useState(base.displayName);
  const [bio, setBio] = useState(base.bio);
  const [avatarUrl, setAvatarUrl] = useState(base.avatarUrl);
  const [headline, setHeadline] = useState(base.headline);
  const [aboutMd, setAboutMd] = useState(base.aboutMd);
  const [interests, setInterests] = useState<string[]>(base.interests);
  const [linkRows, setLinkRows] = useState<LinkRow[]>(() => rowsFrom(base.links));
  const [bannerUrl, setBannerUrl] = useState(base.bannerUrl);

  const [uploading, setUploading] = useState<'avatar' | 'banner' | null>(null);
  const [saving, setSaving] = useState(false);
  const [showLinkErrors, setShowLinkErrors] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const linksRef = useRef<HTMLDivElement>(null);

  const accountDirty = {
    displayName: displayName !== base.displayName,
    bio: bio !== base.bio,
    avatarUrl: avatarUrl !== base.avatarUrl,
  };
  const profileDirty = {
    headline: headline !== base.headline,
    aboutMd: sanitizeAbout(aboutMd) !== sanitizeAbout(base.aboutMd),
    interests: !sameList(interests, base.interests),
    links: !sameRows(linkRows, base.links),
    bannerUrl: bannerUrl !== base.bannerUrl,
  };
  const dirty = Object.values(accountDirty).some(Boolean) || Object.values(profileDirty).some(Boolean);
  useUnsavedGuard(dirty, t('pf_leave_confirm'));

  const invalidLinks = useMemo(() => linksForSave(linkRows).invalidIds, [linkRows]);
  const theme = identityColor(displayName || user.displayName);
  const palette = useMemo(() => cardPalette(settings.card.theme ?? theme), [settings.card.theme, theme]);

  const uploadImage = useCallback(
    async (picked: File, target: 'avatar' | 'banner') => {
      const format = photoFormatOf(picked);
      if (format?.kind !== 'image') {
        pushToast('error', t('pick_image'));
        return;
      }
      if (picked.size > UPLOAD_IMAGE_MAX_BYTES) {
        pushToast('error', t('image_too_large'));
        return;
      }
      setUploading(target);
      try {
        let file: File;
        if (shouldStripImage(format.ext)) {
          try {
            file = await stripImageMetadata(picked);
          } catch {
            pushToast('error', t('pick_image')); // undecodable here ⇒ unsupported, never uploaded raw
            return;
          }
        } else {
          // A GIF keeps its bytes (animation); the route needs a real type even
          // when the OS reported none.
          file = picked.type === 'image/gif' ? picked : new File([picked], picked.name, { type: 'image/gif' });
        }
        const res = await fetch('/api/uploads/image', {
          method: 'POST',
          headers: { 'content-type': file.type, 'x-filename': encodeURIComponent(file.name) },
          body: file,
        });
        const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
        if (!res.ok || !data.url) {
          // The route answers `file_too_large` (413); `too_large` was a stale spelling.
          const code = data.error ?? '';
          pushToast(
            'error',
            code === 'file_too_large' || code === 'too_large' || res.status === 413
              ? t('image_too_large')
              : res.status === 429
                ? t('pf_rate_limited')
                : t('upload_failed'),
          );
          return;
        }
        if (target === 'avatar') setAvatarUrl(data.url);
        else setBannerUrl(data.url);
        pushToast('success', target === 'avatar' ? t('avatar_uploaded') : t('pf_banner_uploaded'));
      } catch {
        pushToast('error', t('upload_failed'));
      } finally {
        setUploading(null);
      }
    },
    [t],
  );

  function discard() {
    setDisplayName(base.displayName);
    setBio(base.bio);
    setAvatarUrl(base.avatarUrl);
    setHeadline(base.headline);
    setAboutMd(base.aboutMd);
    setInterests(base.interests);
    setLinkRows(rowsFrom(base.links));
    setBannerUrl(base.bannerUrl);
    setShowLinkErrors(false);
  }

  async function save() {
    if (saving || !dirty) return;
    const name = displayName.trim();
    if (accountDirty.displayName && (name.length < NAME_MIN || name.length > NAME_MAX)) {
      pushToast('error', t('pf_name_invalid', { min: NAME_MIN, max: NAME_MAX }));
      return;
    }
    const { links, invalidIds } = linksForSave(linkRows);
    if (invalidIds.length > 0) {
      setShowLinkErrors(true);
      pushToast('error', t('pf_links_fix'));
      linksRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const accountBody: Record<string, unknown> = {};
    if (accountDirty.displayName) accountBody.displayName = name;
    if (accountDirty.bio) accountBody.bio = bio;
    if (accountDirty.avatarUrl) accountBody.avatarUrl = avatarUrl;

    const profileBody: Record<string, unknown> = {};
    if (profileDirty.headline) profileBody.headline = headline;
    if (profileDirty.aboutMd) profileBody.aboutMd = aboutMd;
    if (profileDirty.interests) profileBody.interests = interests;
    if (profileDirty.links) profileBody.links = links;
    if (profileDirty.bannerUrl) profileBody.bannerUrl = bannerUrl || null;

    const put = (url: string, body: Record<string, unknown>) =>
      Object.keys(body).length === 0
        ? Promise.resolve(null)
        : fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(
            () => undefined,
          );

    setSaving(true);
    try {
      const [accountRes, profileRes] = await Promise.all([put('/api/auth/me', accountBody), put('/api/me/profile', profileBody)]);
      const accountOk = accountRes === null || !!accountRes?.ok;
      const profileOk = profileRes === null || !!profileRes?.ok;

      let fresh: OwnProfileSettings | null = null;
      if (profileRes && profileRes.ok) {
        fresh = (await profileRes.json().catch(() => null)) as OwnProfileSettings | null;
      }

      setBase((prev) => {
        const next = { ...prev };
        if (accountRes && accountRes.ok) {
          if (accountDirty.displayName) next.displayName = name;
          if (accountDirty.bio) next.bio = bio;
          if (accountDirty.avatarUrl) next.avatarUrl = avatarUrl;
        }
        if (profileRes && profileRes.ok) {
          // The server's sanitized values become the new baseline (whitespace
          // collapsed, `#` stripped from tags, a label defaulted to the host…).
          next.headline = fresh?.headline ?? headline;
          next.aboutMd = fresh?.aboutMd ?? aboutMd;
          next.interests = fresh?.interests ?? interests;
          next.links = fresh?.links ?? links;
          next.bannerUrl = fresh ? fresh.bannerUrl ?? '' : bannerUrl;
        }
        return next;
      });
      if (accountRes && accountRes.ok && accountDirty.displayName) setDisplayName(name);
      if (profileRes && profileRes.ok && fresh) {
        setHeadline(fresh.headline);
        setAboutMd(fresh.aboutMd);
        setInterests(fresh.interests);
        setLinkRows(rowsFrom(fresh.links));
        setBannerUrl(fresh.bannerUrl ?? '');
      }
      setShowLinkErrors(false);

      if (accountOk && profileOk) pushToast('success', t('saved'));
      else pushToast('error', accountOk || profileOk ? t('pf_partial_failed') : t('save_failed'));

      if ((accountRes && accountRes.ok) || (profileRes && profileRes.ok)) invalidateUserCard(user.handle);
      // The JWT carries name + avatar for the navbar; the session callback no
      // longer re-reads the DB per request, so push the change explicitly.
      if (accountRes && accountRes.ok) await update();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const loginMethod =
    user.authMethod === 'both'
      ? `${t('login_password')} + W3 (${user.huaweiW3Id})`
      : user.authMethod === 'huawei_sso'
        ? `W3 (${user.huaweiW3Id})`
        : t('login_password');

  return (
    <div className="space-y-5">
      {/* 01 形象 — banner + avatar composed the way the profile stage shows them */}
      <SettingsSection index={1} title={t('pf_look_title')} description={t('pf_look_desc')}>
        <div>
          <div className="relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            <div className="relative aspect-[5/2] sm:aspect-[4/1]">
              {bannerUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- stored root-relative upload
                <img src={withBasePath(bannerUrl)} alt="" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <div
                  aria-hidden
                  className="absolute inset-0 bg-zinc-50 dark:bg-zinc-900"
                  style={{
                    // `base` is the validated `#rrggbb` from cardPalette; the hex suffix is alpha.
                    backgroundImage: `radial-gradient(90% 130% at 88% 0%, ${palette.base}59 0%, transparent 62%), radial-gradient(70% 120% at 0% 100%, ${palette.base}24 0%, transparent 70%)`,
                  }}
                >
                  <HairlineGrid size={32} mask="center" />
                </div>
              )}
              <div className="absolute right-2 top-2 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => bannerInput.current?.click()}
                  disabled={uploading !== null}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-950/55 px-2.5 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-zinc-950/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-60"
                >
                  {uploading === 'banner' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                  {bannerUrl ? t('pf_banner_replace') : t('pf_banner_upload')}
                </button>
                {bannerUrl && (
                  <button
                    type="button"
                    onClick={() => setBannerUrl('')}
                    aria-label={t('pf_banner_remove')}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-950/55 text-white backdrop-blur-sm transition hover:bg-zinc-950/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
          <input
            ref={bannerInput}
            type="file"
            accept={IMAGE_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadImage(f, 'banner');
              e.target.value = '';
            }}
          />

          <div className="relative -mt-8 flex flex-wrap items-end gap-x-4 gap-y-3 px-4 sm:px-5">
            <div className="rounded-full bg-[rgb(var(--surface))] p-1">
              <Avatar name={displayName || user.displayName} src={avatarUrl || null} size="xl" />
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <p className="truncate text-base font-semibold tracking-tight">{displayName || user.displayName}</p>
              <p className="truncate text-xs text-muted">{headline || t('pf_headline_empty_preview')}</p>
            </div>
            <div className="flex items-center gap-1.5 pb-0.5">
              <button
                type="button"
                onClick={() => avatarInput.current?.click()}
                disabled={uploading !== null}
                className={`${BTN_SECONDARY} h-8 px-3`}
              >
                {uploading === 'avatar' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {t('upload_avatar')}
              </button>
              {avatarUrl && (
                <button type="button" onClick={() => setAvatarUrl('')} className={`${BTN_SECONDARY} h-8 px-2.5`} aria-label={t('remove')}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <input
              ref={avatarInput}
              type="file"
              accept={IMAGE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadImage(f, 'avatar');
                e.target.value = '';
              }}
            />
          </div>
          <p className={`${HINT_CLS} px-4 sm:px-5`}>{t('pf_look_hint')}</p>

          <Link
            href="/settings/card"
            className="group mt-5 flex items-center gap-3 rounded-xl border border-dashed border-zinc-300 px-4 py-3 transition hover:border-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:bg-zinc-900/60"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
              <IdCard className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{t('pf_card_cta_title')}</span>
              <span className="block text-xs text-muted">{t('pf_card_cta_desc')}</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-zinc-900 motion-reduce:transition-none dark:group-hover:text-zinc-100" />
          </Link>
        </div>
      </SettingsSection>

      {/* 02 名字、头衔与签名 */}
      <SettingsSection index={2} title={t('pf_identity_title')} description={t('pf_identity_desc')}>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor={`${formId}-name`} className={LABEL_CLS}>
              <span>{t('display_name')}</span>
              <span className={COUNTER_CLS}>
                {displayName.length}/{NAME_MAX}
              </span>
            </label>
            <input
              id={`${formId}-name`}
              value={displayName}
              maxLength={NAME_MAX}
              onChange={(e) => setDisplayName(e.target.value)}
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label htmlFor={`${formId}-headline`} className={LABEL_CLS}>
              <span>{t('pf_headline')}</span>
              <span className={COUNTER_CLS}>
                {codePointLength(headline)}/{HEADLINE_MAX}
              </span>
            </label>
            <input
              id={`${formId}-headline`}
              value={headline}
              onChange={(e) => setHeadline(sliceCodePoints(e.target.value, HEADLINE_MAX))}
              placeholder={t('pf_headline_placeholder')}
              className={INPUT_CLS}
            />
          </div>
          <div className="md:col-span-2">
            <label htmlFor={`${formId}-bio`} className={LABEL_CLS}>
              <span>{t('pf_bio')}</span>
              <span className={COUNTER_CLS}>
                {bio.length}/{BIO_MAX}
              </span>
            </label>
            <textarea
              id={`${formId}-bio`}
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
              rows={2}
              maxLength={BIO_MAX}
              placeholder={t('bio_placeholder')}
              className={`${TEXTAREA_CLS} resize-y`}
            />
            <p className={HINT_CLS}>{t('pf_bio_hint')}</p>
          </div>
        </div>
      </SettingsSection>

      {/* 03 关于我 */}
      <SettingsSection index={3} title={t('pf_about_title')} description={t('pf_about_desc')}>
        <RichTextEditor
          value={aboutMd}
          onChange={setAboutMd}
          variant="full"
          size="compact"
          maxLength={ABOUT_MAX}
          maxHeight={380}
          placeholder={t('pf_about_placeholder')}
          ariaLabel={t('pf_about_title')}
        />
      </SettingsSection>

      {/* 04 兴趣与外链 */}
      <SettingsSection index={4} title={t('pf_more_title')} description={t('pf_more_desc')}>
        <div className="space-y-6">
          <ChipInput
            value={interests}
            onChange={setInterests}
            max={MAX_INTERESTS}
            label={t('pf_interests')}
            placeholder={t('pf_interests_placeholder')}
            hint={t('pf_interests_hint')}
          />
          <div ref={linksRef}>
            <span className={LABEL_CLS}>
              <span>{t('pf_links')}</span>
            </span>
            <LinksEditor rows={linkRows} onChange={setLinkRows} max={MAX_LINKS} showAllErrors={showLinkErrors} />
          </div>
        </div>
      </SettingsSection>

      {/* 05 账号信息 (read-only) */}
      <SettingsSection index={5} title={t('pf_account_title')} description={t('pf_account_desc')}>
        <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
          <ReadOnly label={t('email')} value={user.email} />
          <ReadOnly label={t('employee_id')} value={user.handle} mono />
          <ReadOnly label={t('login_method')} value={loginMethod} />
          {user.huaweiW3Name && <ReadOnly label={t('w3_name')} value={user.huaweiW3Name} />}
        </dl>
      </SettingsSection>

      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onDiscard={discard}
        disabled={uploading !== null}
        note={showLinkErrors && invalidLinks.length > 0 ? t('pf_links_fix') : null}
      />
    </div>
  );
}

function ReadOnly({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-0.5 truncate text-zinc-900 dark:text-zinc-100 ${mono ? 'font-mono text-[13px]' : ''}`}>{value}</dd>
    </div>
  );
}
