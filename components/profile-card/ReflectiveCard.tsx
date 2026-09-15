'use client';

// 镜面卡 — React Bits <ReflectiveCard/>, minus the webcam (never, ever): the
// member's photo or playing video sits behind frosted metal instead.
//
// The `metallic-displacement` filter is declared per card with a `useId`
// suffix — a page can hold several cards (profile hero + hover card + editor
// previews) and a shared `#metallic-displacement` would make every card render
// through whichever <svg> the browser found first, and vanish with it. The
// reference's glass-distortion tail (erode → blur → second displacement) is
// dropped: at its default strength of 0 it is an identity pass that still
// costs a morphology filter per video frame. The ripple is calmer than the
// reference (lower frequency, softer specular): at 288px a 0.03 turbulence
// with a 1.2 specular reads as hammered tin and eats the small type. Without
// media the card is BRUSHED metal in CSS — the relief filter on a flat colour
// is just lumps.

import { useId } from 'react';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import { Activity, ArrowUpRight, Fingerprint, IdCard } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CARD_BLUR_MAX } from '@/lib/profile/shared';
import { BadgeList } from '@/components/user/BadgeChip';
import { CardMedia } from '@/components/profile-card/CardMedia';
import { StatFigures, useCardBaseStyle, useJoinedLine } from '@/components/profile-card/card-parts';
import {
  CARD_BADGE_MAX,
  deptText,
  fitNameSize,
  hasCJK,
  nameSizeVar,
  usableMedia,
} from '@/components/profile-card/card-shared';
import { useCardTilt } from '@/components/profile-card/useCardTilt';
import type { StyleCardProps } from '@/components/profile-card/HoloCard';

const clampInt = (v: number, min: number, max: number) =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : min;

export function ReflectiveCard({
  view,
  size,
  href,
  live,
  playMedia,
  onMediaPosChange,
  touchReframe,
  className,
}: StyleCardProps) {
  const t = useTranslations('profile');
  const { wrapRef, shellRef, suspendRef } = useCardTilt({ enabled: live, amplitude: 0.4 });
  const base = useCardBaseStyle(view, size);
  const joined = useJoinedLine(view);
  const card = view.card;
  const media = usableMedia(view.media);
  const filterId = `pc-rf-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;

  const blur = clampInt(card.blur, 0, CARD_BLUR_MAX);
  const saturation = 1 - clampInt(card.grayscale, 0, 100) / 100;
  const mediaFilter = `saturate(${saturation}) contrast(120%) brightness(110%) blur(${blur}px) url(#${filterId})`;

  const cjkName = hasCJK(view.displayName);
  // Uppercase Latin with 0.05em tracking is ~15% wider than the estimate; CJK
  // carries 0.14em tracking per glyph.
  const nameUnits = cjkName
    ? fitNameSize(view.displayName, 24, 15, 268 / 1.14)
    : fitNameSize(view.displayName.toUpperCase(), 24, 14, 268 / 1.15);
  const dept = card.showDept ? deptText(view) : '';
  const label = card.label || t('card_label_default');
  const hasStats = card.showStats && view.stats.length > 0;

  const style = { ...base, ...nameSizeVar(nameUnits) } as CSSProperties;

  return (
    <div ref={wrapRef} className={`pc-root pc-reflective ${className}`} style={style} data-size={size}>
      <div ref={shellRef} className="pc-shell">
        <section className="pc-rf-card" aria-label={view.displayName}>
          <svg className="pc-rf-svg" aria-hidden focusable="false">
            <defs>
              <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
                <feTurbulence type="turbulence" baseFrequency="0.018" numOctaves={2} result="noise" />
                <feColorMatrix in="noise" type="luminanceToAlpha" result="noiseAlpha" />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="noise"
                  scale={20}
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result="rippled"
                />
                <feSpecularLighting
                  in="noiseAlpha"
                  surfaceScale={6}
                  specularConstant={0.75}
                  specularExponent={28}
                  lightingColor="#ffffff"
                  result="light"
                >
                  <fePointLight x={0} y={0} z={300} />
                </feSpecularLighting>
                <feComposite in="light" in2="rippled" operator="in" result="light-lit" />
                <feComponentTransfer in="light-lit" result="light-effect">
                  <feFuncA type="linear" slope={0.6} />
                </feComponentTransfer>
                <feBlend in="light-effect" in2="rippled" mode="screen" />
              </filter>
            </defs>
          </svg>

          <div className="pc-rf-media">
            {media ? (
              <CardMedia
                media={media}
                playMedia={playMedia}
                pos={card.mediaPos}
                alt={t('card_media_alt', { name: view.displayName })}
                mediaStyle={{ filter: mediaFilter }}
                fallback={<div className="pc-rf-metal" />}
                onMediaPosChange={onMediaPosChange}
                touchReframe={touchReframe}
                onDragChange={(d) => {
                  suspendRef.current = d;
                }}
              />
            ) : (
              <div className="pc-rf-metal" aria-hidden />
            )}
          </div>
          <div className="pc-rf-noise" aria-hidden />
          <div className="pc-rf-sheen" aria-hidden />
          <div className="pc-rf-glare" aria-hidden />
          <div className="pc-rf-border" aria-hidden />

          <div className="pc-rf-content">
            <div className="pc-rf-header">
              <span className="pc-rf-chip">
                <IdCard aria-hidden />
                <span className="pc-truncate">{label}</span>
              </span>
              <span className="pc-rf-status" title={card.status || undefined}>
                {card.status && <span className="pc-truncate">{card.status}</span>}
                <Activity aria-hidden />
              </span>
            </div>

            <div className="pc-rf-body">
              <div className="pc-rf-user">
                <h3 className={`pc-rf-name pc-truncate ${cjkName ? 'is-cjk' : ''}`}>
                  {href ? (
                    // Mouse target only: the CTA below is the keyboard stop for the same URL.
                    <Link href={href} tabIndex={-1}>
                      {view.displayName}
                    </Link>
                  ) : (
                    view.displayName
                  )}
                </h3>
                {view.headline && (
                  <p className={`pc-rf-role ${hasCJK(view.headline) ? 'is-cjk' : ''}`}>{view.headline}</p>
                )}
                {dept && <p className="pc-rf-dept pc-truncate">{dept}</p>}
              </div>
              {card.showBadges && view.badges.length > 0 && (
                <BadgeList
                  badges={view.badges}
                  max={CARD_BADGE_MAX[size]}
                  size="sm"
                  tone="glass"
                  className="pc-badges"
                />
              )}
              {href && (
                <Link href={href} className="pc-rf-cta pc-focus">
                  {t('card_cta')}
                  <ArrowUpRight aria-hidden />
                </Link>
              )}
            </div>

            <div className="pc-rf-footer">
              <div className="pc-rf-id">
                <span className="pc-rf-label">{t('card_id_label')}</span>
                <span className="pc-rf-value pc-truncate">{view.showHandle ? `@${view.handle}` : joined}</span>
              </div>
              {hasStats ? (
                <StatFigures view={view} className="pc-rf-stats" itemClassName="pc-rf-stat" stacked limit={2} />
              ) : (
                <Fingerprint className="pc-rf-fingerprint" aria-hidden />
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
