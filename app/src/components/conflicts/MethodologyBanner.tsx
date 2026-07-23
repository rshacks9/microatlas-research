/**
 * MethodologyBanner (conflicts.md §2) — honesty strip: SIGNAL / MODEL /
 * CAVEAT cells + link to the full methodology on /sources.
 */

import { Link } from 'react-router';
import { motion } from 'framer-motion';
import HudFrame from '@/components/HudFrame';

const CELLS = [
  {
    label: 'Signal',
    body: 'GDELT timelinevol + timelinetone per zone query, 7-day window, fetched live through the shared 6s queue.',
  },
  {
    label: 'Model',
    body: 'Volume z-score vs 7-day baseline + tone delta → SCORE = 50 + 8·Z + 4·ΔTONE, clamped 0–100, 5-level alert scale.',
  },
  {
    label: 'Caveat',
    body: 'Media-attention proxy. Volume spikes reflect coverage, not only events. Not a prediction of certainty.',
  },
];

export default function MethodologyBanner() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <HudFrame className="border-l-2 border-l-wf-amber">
        <div className="grid gap-4 p-4 md:grid-cols-[1fr_1fr_1fr_auto] md:items-center">
          {CELLS.map((c, i) => (
            <motion.div
              key={c.label}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.4, delay: 0.08 * i, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="font-display text-[11px] font-medium uppercase tracking-[0.14em] text-wf-amber">
                {c.label}
              </div>
              <p className="mt-1 font-body text-[12px] leading-4 text-wf-ink-dim">{c.body}</p>
            </motion.div>
          ))}
          <Link
            to="/sources"
            className="whitespace-nowrap font-data text-[11px] uppercase tracking-[0.08em] text-wf-cyan hover:underline"
          >
            Full methodology →
          </Link>
        </div>
      </HudFrame>
    </motion.div>
  );
}
