'use client';

// The /settings switch — ONE copy of the ink toggle the settings pages used to
// inline four times. `role="switch"` + `aria-checked`; the knob slides on a
// 160 ms left transition that reduced motion turns off. Label it either with
// `label` (aria-label) or by pointing `labelledBy` at a visible heading.
//
// `busy` (a save in flight) is NOT `disabled`: the native attribute on the
// focused button drops keyboard focus to <body> the moment Space is pressed.
// A busy switch stays focusable, announces aria-busy/aria-disabled and ignores
// clicks until the save settles.

export function Switch({
  checked,
  onChange,
  disabled = false,
  busy = false,
  label,
  labelledBy,
  describedBy,
  id,
  className = '',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  busy?: boolean;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  id?: string;
  className?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      onClick={() => {
        if (!busy) onChange(!checked);
      }}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress aria-busy:opacity-60 motion-reduce:transition-none dark:focus-visible:ring-zinc-100 dark:focus-visible:ring-offset-zinc-950 ${
        checked ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-300 dark:bg-zinc-700'
      } ${className}`}
    >
      <span
        aria-hidden
        className={`absolute top-0.5 h-5 w-5 rounded-full shadow-sm transition-[left] duration-150 ease-out motion-reduce:transition-none ${
          checked ? 'left-[22px] bg-white dark:bg-zinc-900' : 'left-0.5 bg-white dark:bg-zinc-300'
        }`}
      />
    </button>
  );
}
