'use client';

import { useRef } from 'react';
import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface Props {
  src: string | null;
  poster: string | null;
  slug: string;
  durationSec: number;
}

// Threshold of actual watch time (seconds) before we register a view. The ping
// is decoupled from playback start so a quick hover/scrub doesn't count.
const VIEW_THRESHOLD_SEC = 5;

export function VideoPlayer({ src, poster, slug }: Props) {
  const t = useTranslations('video');
  const videoRef = useRef<HTMLVideoElement>(null);
  const pingedRef = useRef(false);

  function maybePing() {
    if (pingedRef.current) return;
    const el = videoRef.current;
    if (!el || el.currentTime < VIEW_THRESHOLD_SEC) return;
    pingedRef.current = true;
    fetch(`/api/videos/${slug}/view`, { method: 'POST', keepalive: true }).catch(() => {
      // Best-effort: a failed view ping must never disturb playback.
    });
  }

  if (!src) {
    return (
      <div className="surface relative aspect-video w-full overflow-hidden rounded-2xl">
        {poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt="" className="h-full w-full object-cover opacity-60" />
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
        ref={videoRef}
        controls
        preload="metadata"
        playsInline
        poster={poster ?? undefined}
        src={src}
        onTimeUpdate={maybePing}
        onPlaying={maybePing}
        className="h-full w-full"
      />
    </div>
  );
}
