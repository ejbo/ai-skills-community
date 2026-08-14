// Ambient backdrop for the homepage hero bands. Deliberately colourless: a
// hairline grid, a neutral overhead light, and a film grain. The previous
// version drifted two blurred indigo/sky blobs behind the hero, which is the
// single loudest "AI landing page" tell and the reason the page read as
// generic. Nothing here animates any more, so there is no motion-safe branch
// and no repaint cost on scroll.
//
// Purely decorative (aria-hidden). The parent section must be
// `relative overflow-hidden`.

const GRID_MASK = 'radial-gradient(ellipse 85% 65% at 50% 0%, black 18%, transparent 76%)';

// Monochrome grain, inlined as an SVG data URI so it costs no request and no
// binary asset. feTurbulence is rasterised ONCE into a 140px tile that the
// browser then repeats, so this is a static paint, not a per-frame filter.
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

export function HeroBackdrop({ intensity = 'full' }: { intensity?: 'full' | 'soft' }) {
  const soft = intensity === 'soft';
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Overhead light: the band is a touch brighter than the page at the top
          and settles into it. In dark mode the same move in white at 4%. */}
      <div
        className={`absolute inset-x-0 top-0 dark:hidden ${soft ? 'h-[340px]' : 'h-[520px]'}`}
        style={{
          background:
            'linear-gradient(to bottom, rgb(255 255 255 / 0.85), rgb(255 255 255 / 0))',
        }}
      />
      <div
        className={`absolute inset-x-0 top-0 hidden dark:block ${soft ? 'h-[340px]' : 'h-[520px]'}`}
        style={{
          background:
            'linear-gradient(to bottom, rgb(255 255 255 / 0.045), rgb(255 255 255 / 0))',
        }}
      />
      {/* Hairline grid: structure, not decoration. Faint enough that it reads
          as paper texture rather than as a blueprint. */}
      <div
        className={soft ? 'absolute inset-0 opacity-30 dark:opacity-20' : 'absolute inset-0 opacity-40 dark:opacity-25'}
        style={{
          backgroundImage:
            'linear-gradient(to right, rgb(var(--border) / 0.7) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--border) / 0.7) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: GRID_MASK,
          WebkitMaskImage: GRID_MASK,
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.035] dark:opacity-[0.055]"
        style={{ backgroundImage: GRAIN, backgroundSize: '140px 140px' }}
      />
    </div>
  );
}
