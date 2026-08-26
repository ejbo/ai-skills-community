import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  className?: string;
  /** Sweep angle in degrees. */
  angle?: number;
  /** Peak alpha of the white band (≤ 0.08 — the monochrome light ceiling). */
  alpha?: number;
};

// Server component (no hooks): one gradient layer whose background-position
// transitions on hover — a diagonal glare sweep across a cover image / figure
// frame. Apply to imagery only, never to text cards (it reads as a "wet"
// surface on text). The global `prefers-reduced-motion` rule in globals.css
// zeroes the transition, so it degrades to nothing.
export function GlareHover({ children, className = '', angle = -30, alpha = 0.08 }: Props) {
  return (
    <div className={`group relative overflow-hidden ${className}`}>
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-no-repeat [background-position:-150%_-150%] transition-[background-position] duration-700 ease-out group-hover:[background-position:150%_150%]"
        style={{
          backgroundImage: `linear-gradient(${angle}deg, transparent 40%, rgb(255 255 255 / ${alpha}) 50%, transparent 60%)`,
          backgroundSize: '250% 250%',
        }}
      />
    </div>
  );
}
