'use client';

import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { withBasePath } from '@/lib/video/types';

interface Props {
  src: string | null;
  poster: string | null;
  slug: string;
  durationSec: number;
}

// View counting now lives in <ViewPing> on the detail page (counts on page
// open), so the player is purely presentational.
export function VideoPlayer({ src, poster }: Props) {
  const t = useTranslations('video');

  if (!src) {
    return (
      <div className="surface relative aspect-video w-full overflow-hidden rounded-2xl">
        {poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={withBasePath(poster)} alt="" className="h-full w-full object-cover opacity-60" />
        ) : (
          <div className="h-full w-full bg-zinc-900" />
        )}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 text-white">
          <Lock className="h-6 w-6" />
          <span className="text-sm font-medium">{t('login_required')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
      <video
        controls
        preload="metadata"
        playsInline
        poster={withBasePath(poster) || undefined}
        src={withBasePath(src)}
        className="h-full w-full"
      />
    </div>
  );
}
