/**
 * PageHead — shared scroll-page header (design.md §5 entrance grammar):
 * eyebrow label slides in 12px + fades (0.4s), headline chars stagger
 * 0.015s, sub fades 0.5s with 0.3s delay. Framer Motion only; honors
 * prefers-reduced-motion. Right slot takes live readouts.
 */

import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

export default function PageHead({
  eyebrow,
  eyebrowDot = '#D7E6EF',
  title,
  sub,
  right,
}: {
  eyebrow: string;
  eyebrowDot?: string;
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const chars = title.split('');

  return (
    <div className="flex flex-wrap items-end justify-between gap-6 pt-16">
      <div className="min-w-0">
        <motion.div
          initial={reduce ? false : { opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="flex items-center gap-2 font-display text-[11px] font-medium uppercase tracking-[0.14em] text-wf-ink-dim"
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: eyebrowDot, boxShadow: `0 0 6px ${eyebrowDot}` }}
          />
          {eyebrow}
        </motion.div>

        <h1
          aria-label={title}
          className="mt-3 font-display text-[32px] font-bold leading-[36px] tracking-[0.08em] text-wf-ink sm:text-[40px] sm:leading-[44px]"
        >
          {chars.map((c, i) => (
            <motion.span
              key={`${c}-${i}`}
              aria-hidden
              className="inline-block"
              initial={reduce ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.08 + i * 0.015, ease: 'easeOut' }}
            >
              {c === ' ' ? ' ' : c}
            </motion.span>
          ))}
        </h1>

        {sub && (
          <motion.p
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-3 max-w-[640px] font-body text-sm leading-5 text-wf-ink-dim"
          >
            {sub}
          </motion.p>
        )}
      </div>

      {right && (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35, ease: 'easeOut' }}
          className="shrink-0"
        >
          {right}
        </motion.div>
      )}
    </div>
  );
}
