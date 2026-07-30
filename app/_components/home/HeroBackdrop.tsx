// Decorative ambient backdrop for the homepage hero bands: a radially-masked
// grid plus slowly drifting accent glows. Purely visual (aria-hidden); the
// drift only runs under motion-safe, so reduced-motion users get a static
// backdrop. Parent section must be `relative overflow-hidden`.

const GRID_MASK = 'radial-gradient(ellipse 90% 70% at 50% 0%, black 25%, transparent 75%)';

export function HeroBackdrop({ intensity = 'full' }: { intensity?: 'full' | 'soft' }) {
  const soft = intensity === 'soft';
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0 opacity-40 dark:opacity-25"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgb(var(--border) / 0.6) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--border) / 0.6) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: GRID_MASK,
          WebkitMaskImage: GRID_MASK,
        }}
      />
      <div
        className={`absolute left-1/2 -translate-x-1/2 rounded-full blur-3xl motion-safe:animate-glow-a ${
          soft
            ? 'top-[-280px] h-[380px] w-[640px] bg-accent-500/15 dark:bg-accent-500/10'
            : 'top-[-200px] h-[440px] w-[760px] bg-accent-500/20 dark:bg-accent-500/[0.13]'
        }`}
      />
      {!soft && (
        <div className="absolute right-[6%] top-[-90px] h-[300px] w-[440px] rounded-full bg-sky-400/15 blur-3xl motion-safe:animate-glow-b dark:bg-sky-500/10" />
      )}
    </div>
  );
}
