'use client';

import { motion, useReducedMotion, useSpring, useTransform, type MotionValue } from 'framer-motion';
import { useEffect } from 'react';
import { digitPlaces, rollingDigitOffset } from '@/lib/motion';

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
// Overdamped (ζ ≈ 1.04): a bounce would peek at the neighbouring digit.
const DIGIT_SPRING = { stiffness: 260, damping: 30, mass: 0.8 } as const;

type Props = {
  value: number;
  className?: string;
};

// Odometer-style counter for live figures (like counts): every digit place is
// its own column of 0–9 driven by a spring on `floor(value / place)`, so a
// change rolls only the places that actually changed and 9 → 0 wraps the short
// way. Server and client render identical inline transforms (the spring starts
// at `value`); reduced motion jumps instead of rolling. Non-negative integers
// only — pass the count, not a formatted string.
export function RollingNumber({ value, className = '' }: Props) {
  const n = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  const places = digitPlaces(n);
  return (
    <span className={`inline-flex items-baseline tabular-nums ${className}`}>
      <span className="sr-only">{String(n)}</span>
      <span aria-hidden className="inline-flex items-baseline">
        {places.map((place) => (
          <DigitColumn key={place} place={place} value={n} />
        ))}
      </span>
    </span>
  );
}

function DigitColumn({ place, value }: { place: number; value: number }) {
  const target = Math.floor(value / place);
  const reduce = useReducedMotion();
  const spring = useSpring(target, DIGIT_SPRING);
  useEffect(() => {
    if (reduce) spring.jump(target);
    else spring.set(target);
  }, [spring, target, reduce]);
  return (
    // clip-path instead of overflow-hidden: overflow != visible moves an
    // inline-block's baseline to its bottom edge, which would lift the digits
    // off the neighbouring text's baseline. The invisible in-flow "0" gives
    // the column a real line box (and its baseline) at exactly 1ch × 1em.
    <span className="relative inline-block w-[1ch] leading-none [clip-path:inset(0)]">
      <span className="invisible">0</span>
      {DIGITS.map((d) => (
        <Digit key={d} mv={spring} digit={d} />
      ))}
    </span>
  );
}

function Digit({ mv, digit }: { mv: MotionValue<number>; digit: number }) {
  const y = useTransform(mv, (latest) => `${rollingDigitOffset(latest, digit) * 100}%`);
  return (
    <motion.span style={{ y }} className="absolute inset-0 flex items-center justify-center leading-none">
      {digit}
    </motion.span>
  );
}
