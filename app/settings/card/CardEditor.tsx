'use client';

// 设置 → 名片. Left: the form (媒体 · 样式 · 配色 · 文字 · 显示内容 · 效果).
// Right (sticky on lg): the live stage. Everything the stage shows is built from
// the DRAFT through the same <ProfileCard/> the hover card and the profile page
// render, on top of two SERVER-TRIMMED views (see page.tsx):
//   cardView  → 名片 mode + the style tiles: the member's own profile hero
//   hoverView → 悬停时 mode: what an ordinary signed-in member's hover shows
//               (隐私账号 trimming, hidden sections' stats not counted)
// The draft overlay (headline, card, theme, media) is applied to both the same
// way, so the two previews differ only in what the server decided to reveal.
//
// Save model:
//   · look + words (CardConfig, plus the 头衔 shortcut) → held as a draft, one
//     保存 → PUT /api/me/profile {card, headline?}; the sanitized response
//     becomes the new baseline (so e.g. a trimmed status never reads as dirty).
//   · media → applied immediately by CardMediaField (see there for why, and for
//     when the draft framing `mediaPos` is reset / restored). No router.refresh()
//     follows it; ./applied-media keeps a Router Cache re-mount of this page from
//     showing the media that was just replaced. A video goes
//     through the trimmer dialog first (components/media/VideoTrimDialog): the
//     member picks ≤ PROFILE_CLIP_MAX_SECONDS and the server cuts that clip.
// Every successful save that changes the card (保存, media attach / remove)
// drops this tab's cached hover card of the member (invalidateUserCard), so the
// next hover anywhere in the app shows the new card.

import { useCallback, useDeferredValue, useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { RotateCcw } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { invalidateUserCard } from '@/components/user/UserHoverCard';
import { identityColor } from '@/lib/identity-color';
import {
  CARD_BLUR_MAX,
  CARD_LABEL_MAX,
  CARD_STATUS_MAX,
  CARD_STYLES,
  DEFAULT_CARD_CONFIG,
  HEADLINE_MAX,
  PROFILE_CLIP_MAX_SECONDS,
  parseCardConfig,
  sliceCodePoints,
  type CardConfig,
  type CardStyle,
} from '@/lib/profile/shared';
import type { OwnProfileSettings, ProfileCardMedia, ProfileCardView } from '@/lib/profile/types';
import { SaveBar } from '../_components/SaveBar';
import { SettingsSection } from '../_components/SettingsSection';
import { Switch } from '../_components/Switch';
import { cardConfigsEqual, cardEffectsFor, codePointLength, resetCardLook } from '../_components/editor-shared';
import { useUnsavedGuard } from '../_components/useUnsavedGuard';
import {
  BTN_GHOST,
  COUNTER_CLS,
  HINT_CLS,
  INPUT_CLS,
  LABEL_CLS,
  RANGE_CLS,
  SEGMENT_GROUP_CLS,
  segmentCls,
} from '../_components/ui';
import { appliedMediaFor, rememberAppliedMedia } from './applied-media';
import { CardMediaField, type CardVideoSource } from './CardMediaField';
import { PatternPicker } from './PatternPicker';
import { PreviewStage, type StageMode } from './PreviewStage';
import { StyleTiles } from './StyleTiles';
import { ThemeSwatches } from './ThemeSwatches';

export function CardEditor({
  cardView,
  hoverView,
  settings,
}: {
  cardView: ProfileCardView;
  hoverView: ProfileCardView;
  settings: OwnProfileSettings;
}) {
  const t = useTranslations('settings');
  const router = useRouter();
  const uid = useId();

  const [baseCard, setBaseCard] = useState<CardConfig>(() => parseCardConfig(settings.card));
  const [baseHeadline, setBaseHeadline] = useState(settings.headline);
  const [draft, setDraft] = useState<CardConfig>(baseCard);
  const [headline, setHeadline] = useState(baseHeadline);
  // Media this tab applied over THIS settings object wins over it: a Router Cache
  // re-mount (soft nav back, browser Back) hands the editor the pre-change payload.
  const [appliedOverride] = useState(() => appliedMediaFor(settings));
  const [media, setMedia] = useState<ProfileCardMedia | null>(appliedOverride ? appliedOverride.media : settings.media);
  // The saved video's original (owner-only URL) + the clip it was cut at — what 剪辑片段 reopens.
  const [initialVideoSource] = useState<CardVideoSource | null>(() =>
    appliedOverride
      ? appliedOverride.source
      : settings.mediaKeys.kind === 'video' && settings.mediaKeys.media
        ? { key: settings.mediaKeys.media, url: settings.sourceUrl, clip: settings.clip }
        : null,
  );
  const [localMedia, setLocalMedia] = useState<ProfileCardMedia | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stage, setStage] = useState<StageMode>('card');

  const dirty = !cardConfigsEqual(draft, baseCard) || headline !== baseHeadline;
  useUnsavedGuard(dirty || mediaBusy, mediaBusy ? t('ce_leave_uploading') : t('pf_leave_confirm'));

  const identity = useMemo(() => identityColor(cardView.displayName), [cardView.displayName]);
  const theme = draft.theme ?? identity;
  const shownMedia = localMedia ?? media;
  const effects = cardEffectsFor(draft.style);

  const set = useCallback(<K extends keyof CardConfig>(key: K, value: CardConfig[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  }, []);

  const liveView = useMemo<ProfileCardView>(
    () => ({ ...cardView, headline, card: draft, theme, media: shownMedia }),
    [cardView, headline, draft, theme, shownMedia],
  );
  const liveHoverView = useMemo<ProfileCardView>(
    () => ({ ...hoverView, headline, card: draft, theme, media: shownMedia }),
    [hoverView, headline, draft, theme, shownMedia],
  );

  // The three style tiles follow a DEFERRED copy of the draft: typing a status
  // line re-renders the input and the live stage at once, and the scaled minis
  // catch up in a background render instead of taxing every keystroke.
  const deferredView = useDeferredValue(liveView);
  const tileViews = useMemo(() => {
    const out = {} as Record<CardStyle, ProfileCardView>;
    for (const s of CARD_STYLES) {
      out[s] = { ...deferredView, card: { ...deferredView.card, style: s, tilt: false } };
    }
    return out;
  }, [deferredView]);

  const handle = cardView.handle;
  const onMediaChange = useCallback(
    (next: ProfileCardMedia | null, source: CardVideoSource | null) => {
      setMedia(next);
      rememberAppliedMedia(settings, next, source);
      invalidateUserCard(handle);
    },
    [handle, settings],
  );
  const onMediaPosChange = useCallback((pos: string) => set('mediaPos', pos), [set]);

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { card: draft };
      if (headline !== baseHeadline) body.headline = headline;
      const res = await fetch('/api/me/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        pushToast('error', t('save_failed'));
        return;
      }
      const fresh = (await res.json().catch(() => null)) as OwnProfileSettings | null;
      const nextCard = parseCardConfig(fresh?.card ?? draft);
      const nextHeadline = fresh?.headline ?? headline;
      setBaseCard(nextCard);
      setDraft(nextCard);
      setBaseHeadline(nextHeadline);
      setHeadline(nextHeadline);
      invalidateUserCard(handle);
      pushToast('success', t('ce_saved'));
      router.refresh();
    } catch {
      pushToast('error', t('save_failed'));
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setDraft(baseCard);
    setHeadline(baseHeadline);
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_372px] xl:gap-8">
      {/* Stage first in the DOM order below lg (preview above the form on phones), right column on lg */}
      <aside className="min-w-0 lg:sticky lg:top-24 lg:order-2" aria-label={t('ce_preview_live')}>
        <PreviewStage
          view={liveView}
          hoverView={liveHoverView}
          mode={stage}
          onModeChange={setStage}
          onMediaPosChange={onMediaPosChange}
          onResetPos={() => set('mediaPos', '')}
        />
      </aside>

      <div className="min-w-0 space-y-5 lg:order-1">
        <SettingsSection index={1} title={t('ce_media_title')} description={t('ce_media_desc', { seconds: PROFILE_CLIP_MAX_SECONDS })}>
          <CardMediaField
            media={media}
            initialSource={initialVideoSource}
            mediaPos={draft.mediaPos}
            onMediaChange={onMediaChange}
            onMediaPosChange={onMediaPosChange}
            onLocalPreview={setLocalMedia}
            onBusyChange={setMediaBusy}
          />
        </SettingsSection>

        <SettingsSection
          index={2}
          title={t('ce_style_title')}
          description={t('ce_style_desc')}
          actions={
            !cardConfigsEqual(resetCardLook(draft, DEFAULT_CARD_CONFIG), draft) ? (
              <button type="button" onClick={() => setDraft((d) => resetCardLook(d, DEFAULT_CARD_CONFIG))} className={`${BTN_GHOST} text-xs`}>
                <RotateCcw className="h-3.5 w-3.5" />
                {t('ce_reset_look')}
              </button>
            ) : null
          }
        >
          <StyleTiles value={draft.style} views={tileViews} onChange={(s) => set('style', s)} />
        </SettingsSection>

        <SettingsSection index={3} title={t('ce_theme_title')} description={t('ce_theme_desc')}>
          <ThemeSwatches value={draft.theme} identity={identity} onChange={(v) => set('theme', v)} />
        </SettingsSection>

        <SettingsSection index={4} title={t('ce_text_title')} description={t('ce_text_desc')}>
          <div className="space-y-4">
            <div>
              <label htmlFor={`${uid}-headline`} className={LABEL_CLS}>
                <span>{t('pf_headline')}</span>
                <span className={COUNTER_CLS}>
                  {codePointLength(headline)}/{HEADLINE_MAX}
                </span>
              </label>
              <input
                id={`${uid}-headline`}
                value={headline}
                onChange={(e) => setHeadline(sliceCodePoints(e.target.value, HEADLINE_MAX))}
                placeholder={t('pf_headline_placeholder')}
                className={INPUT_CLS}
              />
              <p className={HINT_CLS}>{t('ce_headline_hint')}</p>
            </div>
            <div>
              <label htmlFor={`${uid}-status`} className={LABEL_CLS}>
                <span>{t('ce_status')}</span>
                <span className={COUNTER_CLS}>
                  {codePointLength(draft.status)}/{CARD_STATUS_MAX}
                </span>
              </label>
              <input
                id={`${uid}-status`}
                value={draft.status}
                onChange={(e) => set('status', sliceCodePoints(e.target.value, CARD_STATUS_MAX))}
                placeholder={t('ce_status_placeholder')}
                className={INPUT_CLS}
              />
              <p className={HINT_CLS}>{t('ce_status_hint')}</p>
            </div>
            {effects.label && (
              <div>
                <label htmlFor={`${uid}-label`} className={LABEL_CLS}>
                  <span>{t('ce_label')}</span>
                  <span className={COUNTER_CLS}>
                    {codePointLength(draft.label)}/{CARD_LABEL_MAX}
                  </span>
                </label>
                <input
                  id={`${uid}-label`}
                  value={draft.label}
                  onChange={(e) => set('label', sliceCodePoints(e.target.value, CARD_LABEL_MAX))}
                  placeholder="CARI · MEMBER"
                  className={`${INPUT_CLS} font-mono text-[13px] tracking-wide`}
                />
                <p className={HINT_CLS}>{t('ce_label_hint')}</p>
              </div>
            )}
          </div>
        </SettingsSection>

        <SettingsSection index={5} title={t('ce_show_title')} description={t('ce_show_desc')}>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            <ToggleRow
              id={`${uid}-dept`}
              title={t('ce_show_dept')}
              desc={t('ce_show_dept_desc')}
              checked={draft.showDept}
              onChange={(v) => set('showDept', v)}
            />
            <ToggleRow
              id={`${uid}-badges`}
              title={t('ce_show_badges')}
              desc={t('ce_show_badges_desc')}
              checked={draft.showBadges}
              onChange={(v) => set('showBadges', v)}
            />
            <ToggleRow
              id={`${uid}-stats`}
              title={t('ce_show_stats')}
              desc={t('ce_show_stats_desc')}
              checked={draft.showStats}
              onChange={(v) => set('showStats', v)}
            />
          </div>
        </SettingsSection>

        <SettingsSection index={6} title={t('ce_fx_title')} description={t('ce_fx_desc', { style: t(`ce_style_${draft.style}`) })}>
          {draft.style === 'minimal' ? (
            <p className="rounded-lg bg-zinc-50 px-3 py-2.5 text-xs leading-relaxed text-muted dark:bg-zinc-900/60">{t('ce_fx_minimal')}</p>
          ) : (
            <div className="space-y-5">
              {effects.tilt && (
                <div>
                  <ToggleRow
                    id={`${uid}-tilt`}
                    title={t('ce_tilt')}
                    desc={t('ce_tilt_desc')}
                    checked={draft.tilt}
                    onChange={(v) => set('tilt', v)}
                  />
                </div>
              )}
              {effects.pattern && (
                <div className="border-t border-zinc-100 pt-5 dark:border-zinc-800/70">
                  <span className={LABEL_CLS}>{t('ce_pattern')}</span>
                  <PatternPicker value={draft.pattern} theme={theme} onChange={(p) => set('pattern', p)} />
                </div>
              )}
              {effects.mediaTone && (
                <div className="border-t border-zinc-100 pt-5 dark:border-zinc-800/70">
                  <span className={LABEL_CLS}>{t('ce_tone')}</span>
                  <div role="radiogroup" aria-label={t('ce_tone')} className={SEGMENT_GROUP_CLS}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={draft.mediaTone === 'blend'}
                      onClick={() => set('mediaTone', 'blend')}
                      className={segmentCls(draft.mediaTone === 'blend')}
                    >
                      {t('ce_tone_blend')}
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={draft.mediaTone === 'natural'}
                      onClick={() => set('mediaTone', 'natural')}
                      className={segmentCls(draft.mediaTone === 'natural')}
                    >
                      {t('ce_tone_natural')}
                    </button>
                  </div>
                  <p className={HINT_CLS}>{shownMedia ? t('ce_tone_hint') : t('ce_tone_hint_nomedia')}</p>
                </div>
              )}
              {effects.reflective && (
                <div className="grid gap-5 border-t border-zinc-100 pt-5 sm:grid-cols-2 dark:border-zinc-800/70">
                  <Slider
                    id={`${uid}-blur`}
                    label={t('ce_blur')}
                    value={draft.blur}
                    min={0}
                    max={CARD_BLUR_MAX}
                    unit="px"
                    onChange={(v) => set('blur', v)}
                  />
                  <Slider
                    id={`${uid}-gray`}
                    label={t('ce_grayscale')}
                    value={draft.grayscale}
                    min={0}
                    max={100}
                    unit="%"
                    onChange={(v) => set('grayscale', v)}
                  />
                  <p className={`${HINT_CLS} mt-0 sm:col-span-2`}>{t('ce_reflective_hint')}</p>
                </div>
              )}
            </div>
          )}
        </SettingsSection>

        <SaveBar
          dirty={dirty}
          saving={saving}
          onSave={() => void save()}
          onDiscard={discard}
          note={mediaBusy && !dirty ? t('ce_media_busy_note') : null}
        />
      </div>
    </div>
  );
}

function ToggleRow({
  id,
  title,
  desc,
  checked,
  onChange,
}: {
  id: string;
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p id={`${id}-t`} className="text-sm text-zinc-900 dark:text-zinc-100">
          {title}
        </p>
        <p id={`${id}-d`} className="mt-0.5 text-xs leading-relaxed text-muted">
          {desc}
        </p>
      </div>
      <Switch checked={checked} onChange={onChange} labelledBy={`${id}-t`} describedBy={`${id}-d`} className="mt-0.5" />
    </div>
  );
}

function Slider({
  id,
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className={LABEL_CLS}>
        <span>{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-zinc-900 dark:text-zinc-100">
          {value}
          {unit}
        </span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={RANGE_CLS}
      />
    </div>
  );
}
