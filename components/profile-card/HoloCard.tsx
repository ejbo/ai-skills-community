'use client';

// 全息卡 — React Bits <ProfileCard/>, re-themed per member.
//
// Layer stack, bottom → top (the reference's, with our content slotted in):
//   inner gradient (theme) → media / avatar / monogram (faded in from the top,
//   luminosity-blended when mediaTone = blend) → legibility scrim → badges,
//   stats and the glass user bar → holographic shine (cut through the pattern
//   mask) → glare → name + headline (gradient text, parallax).
// The shine and glare sit ABOVE the user bar on purpose — that is what makes
// the glass catch the light — and are pointer-events: none, so the bar, the
// CTA and the badge chips stay clickable through them.
//
// DOM order is READING order, not paint order (every layer carries an explicit
// z-index, so the stack above does not depend on it): name + headline first,
// then badges, stats and the bar — a screen reader and the Tab key walk the card
// top to bottom. The name link is a mouse target only (tabIndex -1): the 主页
// CTA goes to the same URL, and two tab stops for one destination is noise.

import { useState } from 'react';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { withBasePath } from '@/lib/base-path';
import type { ProfileCardView } from '@/lib/profile/types';
import { BadgeList } from '@/components/user/BadgeChip';
import { CardMedia } from '@/components/profile-card/CardMedia';
import {
  MiniAvatar,
  StatFigures,
  useCardBaseStyle,
  useInViewFlag,
  useJoinedLine,
} from '@/components/profile-card/card-parts';
import {
  CARD_BADGE_MAX,
  deptText,
  fitNameSize,
  handleText,
  initialOf,
  nameSizeVar,
  usableMedia,
  type ProfileCardSize,
} from '@/components/profile-card/card-shared';
import { CARD_PATTERN_MASKS } from '@/components/profile-card/patterns';
import { useCardTilt } from '@/components/profile-card/useCardTilt';

export interface StyleCardProps {
  view: ProfileCardView;
  size: ProfileCardSize;
  href: string | null;
  live: boolean;
  /** false = an inert mini (style tiles): no tilt, no idle shine drift. */
  interactive: boolean;
  playMedia: boolean;
  onMediaPosChange?: (pos: string) => void;
  touchReframe: boolean;
  className: string;
}

export function HoloCard({
  view,
  size,
  href,
  live,
  interactive,
  playMedia,
  onMediaPosChange,
  touchReframe,
  className,
}: StyleCardProps) {
  const t = useTranslations('profile');
  const { wrapRef, shellRef, suspendRef } = useCardTilt({ enabled: live });
  useInViewFlag(wrapRef, interactive);
  const base = useCardBaseStyle(view, size);
  const joined = useJoinedLine(view);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
  const card = view.card;
  const media = usableMedia(view.media);
  const pattern = CARD_PATTERN_MASKS[card.pattern];
  const dept = card.showDept ? deptText(view) : '';
  const hasAvatarPhoto = !!view.avatarUrl && !avatarBroken;
  // No media — or media whose still failed to load — gets the same treatment:
  // the avatar photo, else the monogram.
  const noMedia = hasAvatarPhoto ? (
    // eslint-disable-next-line @next/next/no-img-element -- member avatar, same-origin upload
    <img
      src={withBasePath(view.avatarUrl)}
      alt=""
      draggable={false}
      className="pc-media-el"
      onError={() => setAvatarBroken(true)}
    />
  ) : (
    <div className="pc-monogram" aria-hidden>
      <span>{initialOf(view.displayName || view.handle)}</span>
    </div>
  );
  const photoShown = media ? !mediaFailed || hasAvatarPhoto : hasAvatarPhoto;
  const tone = photoShown ? card.mediaTone : 'natural';

  const style = {
    ...base,
    '--icon': pattern.url,
    '--pc-pattern-size': pattern.size ? `calc(var(--pc-u) * ${pattern.size})` : '100% 100%',
    ...nameSizeVar(fitNameSize(view.displayName, 30, 17, 276)),
  } as CSSProperties;

  const nameNode = href ? (
    <Link href={href} tabIndex={-1}>
      {view.displayName}
    </Link>
  ) : (
    view.displayName
  );

  return (
    <div
      ref={wrapRef}
      className={`pc-root pc-holo ${interactive ? '' : 'pc-static'} ${className}`}
      style={style}
      data-size={size}
    >
      <div className="pc-behind" aria-hidden />
      <div ref={shellRef} className="pc-shell">
        <section className="pc-card" aria-label={view.displayName}>
          <div className="pc-inside">
            <div className="pc-layer pc-holo-media" data-tone={tone}>
              {media ? (
                <CardMedia
                  media={media}
                  playMedia={playMedia}
                  pos={card.mediaPos}
                  alt={t('card_media_alt', { name: view.displayName })}
                  fallback={noMedia}
                  onStillFailedChange={setMediaFailed}
                  onMediaPosChange={onMediaPosChange}
                  touchReframe={touchReframe}
                  onDragChange={(d) => {
                    suspendRef.current = d;
                  }}
                />
              ) : (
                noMedia
              )}
            </div>
            <div className="pc-layer pc-holo-scrim" aria-hidden />

            <div className="pc-layer pc-holo-details">
              <h3 className="pc-holo-name">{nameNode}</h3>
              {view.headline && <p className="pc-holo-headline">{view.headline}</p>}
              {dept && (
                <p className="pc-holo-dept">
                  <Building2 aria-hidden />
                  <span className="pc-truncate">{dept}</span>
                </p>
              )}
            </div>

            <div className="pc-holo-lower">
              {(card.showBadges && view.badges.length > 0) || (card.showStats && view.stats.length > 0) ? (
                <div className="pc-holo-meta">
                  {card.showBadges && view.badges.length > 0 && (
                    <BadgeList
                      badges={view.badges}
                      max={CARD_BADGE_MAX[size]}
                      size="sm"
                      tone="glass"
                      className="pc-badges"
                    />
                  )}
                  {card.showStats && <StatFigures view={view} className="pc-stats" />}
                </div>
              ) : null}
              <div className="pc-user-info">
                <div className="pc-user-details">
                  <MiniAvatar view={view} className="pc-mini-avatar" />
                  <div className="pc-user-text">
                    <div className="pc-handle pc-truncate">{handleText(view)}</div>
                    <div className="pc-status pc-truncate">{card.status || joined}</div>
                  </div>
                </div>
                {href && (
                  <Link href={href} className="pc-contact-btn pc-focus">
                    {t('card_cta')}
                  </Link>
                )}
              </div>
            </div>

            <div className="pc-layer pc-shine" aria-hidden />
            <div className="pc-layer pc-glare" aria-hidden />
          </div>
        </section>
      </div>
    </div>
  );
}
