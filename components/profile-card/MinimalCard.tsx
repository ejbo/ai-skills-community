'use client';

// 简约卡 — a surface card that follows the SITE theme (light/dark tokens),
// for members who want their 名片 to read like the rest of the page. The
// member's material still has its colour: the top band is their photo/video,
// or a wash of their theme colour with a hairline grid and a watermark
// initial. Chrome on it (the CTA) is ink, per the 配色契约.

import type { CSSProperties } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Building2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { BadgeList } from '@/components/user/BadgeChip';
import { CardMedia } from '@/components/profile-card/CardMedia';
import { MiniAvatar, StatFigures, useCardBaseStyle, useJoinedLine } from '@/components/profile-card/card-parts';
import {
  CARD_BADGE_MAX,
  deptText,
  fitNameSize,
  initialOf,
  nameSizeVar,
  usableMedia,
} from '@/components/profile-card/card-shared';
import type { StyleCardProps } from '@/components/profile-card/HoloCard';

export function MinimalCard({ view, size, href, playMedia, onMediaPosChange, touchReframe, className }: StyleCardProps) {
  const t = useTranslations('profile');
  const base = useCardBaseStyle(view, size);
  const joined = useJoinedLine(view);
  const card = view.card;
  const subline = card.status || joined;
  const media = usableMedia(view.media);
  const dept = card.showDept ? deptText(view) : '';
  const style = { ...base, ...nameSizeVar(fitNameSize(view.displayName, 20, 15, 284)) } as CSSProperties;
  const wash = (
    <>
      <div className="pc-mn-wash" aria-hidden />
      <span className="pc-mn-glyph" aria-hidden>
        {initialOf(view.displayName || view.handle)}
      </span>
    </>
  );

  return (
    <div className={`pc-root pc-minimal ${className}`} style={style} data-size={size}>
      <article className="pc-mn-card" aria-label={view.displayName}>
        <div className="pc-mn-band">
          {media ? (
            <CardMedia
              media={media}
              playMedia={playMedia}
              pos={card.mediaPos}
              alt={t('card_media_alt', { name: view.displayName })}
              fallback={wash}
              onMediaPosChange={onMediaPosChange}
              touchReframe={touchReframe}
            />
          ) : (
            wash
          )}
          <div className="pc-mn-grain" aria-hidden />
          <div className="pc-mn-band-fade" aria-hidden />
        </div>

        <div className="pc-mn-body">
          <div className="pc-mn-top">
            <MiniAvatar view={view} className="pc-mn-avatar" />
            {href && (
              <Link href={href} className="pc-mn-cta">
                {t('card_cta')}
                <ArrowUpRight aria-hidden />
              </Link>
            )}
          </div>

          <h3 className="pc-mn-name pc-truncate">
            {/* Mouse target only: the CTA above is the keyboard stop for the same URL. */}
            {href ? (
              <Link href={href} tabIndex={-1}>
                {view.displayName}
              </Link>
            ) : (
              view.displayName
            )}
          </h3>
          <div className="pc-mn-sub pc-truncate">
            {view.showHandle && <span>@{view.handle}</span>}
            {subline && (
              <>
                {view.showHandle ? (
                  <span className={card.status ? 'pc-mn-status-dot' : 'pc-mn-sep'} aria-hidden>
                    {card.status ? null : '·'}
                  </span>
                ) : null}
                <span>{subline}</span>
              </>
            )}
          </div>
          {view.headline && <p className="pc-mn-headline">{view.headline}</p>}
          {dept && (
            <span className="pc-mn-dept">
              <Building2 aria-hidden />
              <span className="pc-truncate">{dept}</span>
            </span>
          )}
          {view.bio && <p className="pc-mn-bio">{view.bio}</p>}
          {card.showBadges && view.badges.length > 0 && (
            <div className="pc-mn-badges">
              <BadgeList badges={view.badges} max={CARD_BADGE_MAX[size]} size="sm" tone="surface" className="pc-badges" />
            </div>
          )}
          {card.showStats && <StatFigures view={view} className="pc-mn-stats" />}
        </div>
      </article>
    </div>
  );
}
