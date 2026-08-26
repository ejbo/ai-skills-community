// Server component. Purely decorative; the parent must be `relative overflow-hidden`.
// Reuses the exact tokens of app/_components/home/HeroBackdrop.tsx so a zone
// header band and the homepage read as one material — a hairline grid in
// `rgb(var(--border))`, masked so it fades out, optionally drifting one cell
// per minute (`.animate-grid-drift` in globals.css; `motion-safe:` gates it,
// and the global reduced-motion rule zeroes it anyway). No colour, no glow.
const MASKS = {
  top: 'radial-gradient(ellipse 85% 65% at 50% 0%, black 18%, transparent 76%)',
  center: 'radial-gradient(ellipse 70% 70% at 50% 50%, black 10%, transparent 75%)',
  none: 'none',
} as const;

type Props = {
  /** Cell size in px. */
  size?: number;
  mask?: keyof typeof MASKS;
  /** Slow one-cell drift (perceptible only if you stare, never on a scroll frame). */
  drift?: boolean;
  className?: string;
};

export function HairlineGrid({ size = 64, mask = 'top', drift = false, className = '' }: Props) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 ${className}`}>
      <div
        className={`absolute inset-0 opacity-40 dark:opacity-25 ${drift ? 'motion-safe:animate-grid-drift' : ''}`}
        style={{
          backgroundImage:
            'linear-gradient(to right, rgb(var(--border) / 0.7) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--border) / 0.7) 1px, transparent 1px)',
          backgroundSize: `${size}px ${size}px`,
          ['--grid-size' as string]: `${size}px`,
          maskImage: MASKS[mask],
          WebkitMaskImage: MASKS[mask],
        }}
      />
    </div>
  );
}
