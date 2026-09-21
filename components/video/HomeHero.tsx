'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Info, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { HeroVideo } from '@/lib/video/queries';
import { withBasePath } from '@/lib/video/types';
import { DescriptionModal } from '@/components/video/DescriptionModal';
import { CoverImage } from '@/components/media/CoverImage';
import { coverAspectOf, videoCoverRatio } from '@/lib/media/cover-pos';

// 首页横幅 (Geek Videos billboard).
//
// The banner is ~3:1 and covers are 16:9 (or 3:4 海报), so filling it with
// `object-cover` cut 40 % of every cover's height away — titles and heads went
// first, which is what 「边角被截断」 was. Two layers now, and NOTHING is cropped
// by the banner:
//   · ambient  the poster, blurred and dimmed, fills the banner. The colour of
//              the band therefore comes from the material, not from chrome.
//   · artwork  the cover (and, over it, the muted preview clip) in ITS OWN frame
//              — `videoCoverRatio(posterAspect)`, the same ratio the crop editor
//              and the cards use — pinned right at the banner's full height. A
//              landscape cover feathers into the ambient layer on its left edge
//              (CSS mask), a portrait one stands as a floating poster card.
//              How the image sits INSIDE that frame is the shared cover contract
//              (<CoverImage/>): centre crop / the author's crop / 完整显示.
// Phones stack: the artwork on top in a 16:9 slot (a portrait cover is framed
// inside it), the text below on the ambient layer.

const ROTATE_MS = 8000;

export function HomeHero({ videos }: { videos: HeroVideo[] }) {
  const t = useTranslations('video');
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const items = videos.slice(0, 6);
  const active = items[index];

  // Auto-rotate billboard. Re-arming on every index change means a manual
  // prev/next click also resets the timer; pause entirely while the modal reads.
  useEffect(() => {
    if (items.length <= 1 || modalOpen) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % items.length), ROTATE_MS);
    return () => clearInterval(id);
  }, [index, items.length, modalOpen]);

  // Only the dedicated preview clip plays in the hero background — never the full
  // source (which would autoplay-download a multi-GB file on every homepage load).
  const previewSrc = active ? active.previewUrl ?? null : null;

  // Restart the background preview whenever the active item changes.
  useEffect(() => {
    if (reduceMotion) return;
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = 0;
    el.play().catch(() => {
      /* autoplay may be blocked */
    });
  }, [index, reduceMotion, previewSrc]);

  if (!active) return null;

  const subtitle = [active.intervieweeName, active.intervieweeTitle].filter(Boolean).join(' · ');
  const go = (delta: number) => setIndex((i) => (i + delta + items.length) % items.length);

  // The artwork frame follows the cover's own 版式 (16:9 / 3:4) and is never
  // cropped by the banner — see the header comment.
  const aspect = coverAspectOf(active.posterAspect);
  const portrait = aspect === 'portrait';
  const ratio = videoCoverRatio(aspect);
  // The preview clip has the VIDEO's shape, which may differ from the cover's
  // (a portrait 海报 on a landscape talk): fill the frame only when they agree.
  const videoPortrait = Boolean(active.width && active.height && active.height > active.width);
  const previewFit = videoPortrait === portrait ? 'object-cover' : 'object-contain';

  return (
    <section className="group relative isolate -mx-4 overflow-hidden rounded-none bg-zinc-950 text-white [overflow:clip] sm:mx-0 sm:rounded-2xl">
      {/* Ambient layer: the poster, blurred and dimmed, filling the whole banner. */}
      <AnimatePresence mode="popLayout">
        <motion.div
          key={active.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.8, ease: 'easeOut' }}
          // overflow-hidden HERE, not only on the section: the scaled-up blur must be
          // clipped by its own box, or it becomes scrollable overflow of the section and
          // a focus() / scrollIntoView() inside the banner shifts the whole band upward
          // (`overflow: hidden` still scrolls programmatically; the section adds
          // `overflow: clip` for the browsers that have it).
          className="absolute inset-0 -z-10 overflow-hidden"
          aria-hidden
        >
          {active.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- stored root-relative media url
            <img src={withBasePath(active.posterUrl)} alt="" className="h-full w-full scale-125 object-cover opacity-80 blur-3xl brightness-125 saturate-150" />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-zinc-800 to-zinc-950" />
          )}
          <div className="absolute inset-0 bg-zinc-950/40" />
        </motion.div>
      </AnimatePresence>

      <div className="relative flex flex-col sm:block sm:aspect-[21/8] lg:aspect-[21/7]">
        {/* Artwork: phones stack it on top at 16:9 (a portrait cover stands framed inside);
            from sm it is pinned right at the banner's full height in its OWN ratio. */}
        <AnimatePresence mode="popLayout">
          <motion.div
            key={active.id}
            initial={{ opacity: 0, scale: reduceMotion ? 1 : 1.02 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.8, ease: 'easeOut' }}
            className={`relative aspect-video w-full overflow-hidden sm:absolute sm:aspect-auto sm:w-auto sm:max-w-[74%] ${
              portrait
                ? 'sm:bottom-10 sm:right-8 sm:top-5 sm:rounded-xl sm:shadow-2xl sm:ring-1 sm:ring-white/10 lg:right-14'
                : 'sm:inset-y-0 sm:right-0 sm:[-webkit-mask-image:linear-gradient(to_right,transparent,black_30%)] sm:[mask-image:linear-gradient(to_right,transparent,black_30%)]'
            }`}
            style={{ '--hero-ratio': String(ratio) } as React.CSSProperties}
          >
            {/* The ratio applies from sm only (phones keep the 16:9 slot), hence a variable + an arbitrary property. */}
            <div className="absolute inset-0 sm:static sm:h-full sm:[aspect-ratio:var(--hero-ratio)]">
              <div className="absolute inset-0 sm:hidden">
                {active.posterUrl && <CoverImage src={active.posterUrl} aspect={aspect} pos={active.posterPos} loading="eager" />}
              </div>
              <div className="absolute inset-0 hidden sm:block">
                {active.posterUrl && <CoverImage src={active.posterUrl} aspect={aspect} pos={active.posterPos} slot="adaptive" loading="eager" />}
              </div>
              {!reduceMotion && previewSrc && (
                <video
                  ref={videoRef}
                  src={withBasePath(previewSrc)}
                  muted
                  loop
                  playsInline
                  preload="none"
                  aria-hidden
                  className={`absolute inset-0 h-full w-full ${previewFit}`}
                />
              )}
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Legibility: a left-to-right veil under the text (sm+), a bottom veil on phones. */}
        <div className="pointer-events-none absolute inset-0 hidden bg-gradient-to-r from-zinc-950/75 via-zinc-950/25 to-transparent sm:block" />

        {/* Foreground content */}
        <div className="relative flex items-end sm:absolute sm:inset-0">
          <div className="w-full px-5 pb-6 pt-5 sm:px-8 sm:pb-8 sm:pt-0 lg:px-12 lg:pb-10">
            <AnimatePresence mode="wait">
              <motion.div
                key={active.id}
                initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
                transition={{ duration: reduceMotion ? 0 : 0.5, ease: 'easeOut' }}
                className={portrait ? 'sm:max-w-[60%] lg:max-w-2xl' : 'sm:max-w-[52%] lg:max-w-[46%]'}
              >
                {active.category?.name && (
                  <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white backdrop-blur">
                    {t('home.featured')} · {active.category.name}
                  </span>
                )}
                <h1 className="line-clamp-3 text-2xl font-bold tracking-tight text-white drop-shadow-md sm:text-3xl lg:text-4xl xl:text-5xl">
                  {active.title}
                </h1>
                {subtitle && (
                  <p className="mt-2 text-sm font-medium text-white/80 sm:text-base">{subtitle}</p>
                )}
                {active.summary && (
                  <p className="mt-3 line-clamp-2 max-w-xl text-sm text-white/75 lg:line-clamp-3 lg:text-base">
                    {active.summary}
                  </p>
                )}

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Link
                    href={`/videos/${active.slug}`}
                    className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-6 text-sm font-semibold text-zinc-900 shadow-sm transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <Play className="h-5 w-5 fill-current" />
                    {t('home.watch')}
                  </Link>
                  <button
                    type="button"
                    onClick={() => setModalOpen(true)}
                    className="inline-flex h-11 items-center gap-2 rounded-xl bg-white/20 px-6 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  >
                    <Info className="h-5 w-5" />
                    {t('home.more')}
                  </button>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Prev / next arrows — fade in on hover (always visible on touch) */}
        {items.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label={t('home.prev')}
              className="absolute left-3 top-[28vw] z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/35 text-white backdrop-blur transition-all duration-300 hover:bg-black/60 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:left-4 sm:top-1/2 sm:opacity-0 sm:group-hover:opacity-100"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label={t('home.next')}
              className="absolute right-3 top-[28vw] z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/35 text-white backdrop-blur transition-all duration-300 hover:bg-black/60 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:right-4 sm:top-1/2 sm:opacity-0 sm:group-hover:opacity-100"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}

        {/* Manual dots */}
        {items.length > 1 && (
          <div className="absolute bottom-4 right-5 z-10 flex items-center gap-2 sm:right-8 lg:right-12">
            {items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show ${item.title}`}
                aria-current={i === index}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === index ? 'w-6 bg-white' : 'w-2 bg-white/40 hover:bg-white/70'
                }`}
              />
            ))}
          </div>
        )}
      </div>

      <DescriptionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={active.title}
        content={active.descriptionMd.trim() || active.summary}
        detailHref={`/videos/${active.slug}`}
      />
    </section>
  );
}
