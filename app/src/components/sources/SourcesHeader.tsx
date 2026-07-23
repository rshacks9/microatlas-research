/**
 * SourcesHeader — sources.md §1. Eyebrow, H1, manifesto with word-level
 * fade stagger (0.008s/word), and the aggregate health readout
 * `SOURCES n/8 LIVE` (degrades honestly; red + one-time shake on ERROR)
 * plus LAST GLOBAL REFRESH age.
 */

import { motion, useReducedMotion } from 'framer-motion';
import { derivedStatus, ageLabel, useLiveState } from '@/store/useLiveStore';
import { useNow } from '@/components/intel/wire';
import { REGISTRY, registryLiveCount } from './registry';

const MANIFESTO =
  'Every object, article, tone score, and audio stream in WATCHFLOOR is fetched live from the public sources below, in your browser, at view time. When a source fails, the interface says so — with the error, the timestamp, and a retry countdown. Derived analytics are labeled as indicators. There is no synthetic, placeholder, or demonstration data anywhere in this application.';

export default function SourcesHeader() {
  const state = useLiveState();
  const now = useNow();
  const reduce = useReducedMotion();

  const live = registryLiveCount(state, now);
  const anyError = REGISTRY.some((r) => r.key && state[r.key].status === 'error');
  const healthColor = anyError ? '#FF3B47' : live === REGISTRY.length ? '#3DF58A' : '#FFB020';

  const lastFetches = REGISTRY.map((r) => (r.key ? state[r.key].lastFetch : null)).filter(
    (v): v is number => v != null,
  );
  const lastGlobal = lastFetches.length ? Math.max(...lastFetches) : null;

  const words = MANIFESTO.split(' ');

  return (
    <div className="flex flex-wrap items-start justify-between gap-8 pt-16">
      <div className="min-w-0 max-w-[760px]">
        <motion.div
          initial={reduce ? false : { opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="flex items-center gap-2 font-display text-[11px] font-medium uppercase tracking-[0.14em] text-wf-ink-dim"
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-wf-green" style={{ boxShadow: '0 0 6px #3DF58A' }} />
          Data Provenance
        </motion.div>

        <h1
          aria-label="NOTHING HERE IS FAKE"
          className="mt-3 font-display text-[32px] font-bold leading-[36px] tracking-[0.08em] text-wf-ink sm:text-[40px] sm:leading-[44px]"
        >
          {'NOTHING HERE IS FAKE'.split('').map((c, i) => (
            <motion.span
              key={`${c}-${i}`}
              aria-hidden
              className="inline-block"
              initial={reduce ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.08 + i * 0.015, ease: 'easeOut' }}
            >
              {c === ' ' ? ' ' : c}
            </motion.span>
          ))}
        </h1>

        <p className="mt-4 font-body text-sm leading-6 text-wf-ink">
          {words.map((w, i) => (
            <motion.span
              key={`${w}-${i}`}
              className="inline-block"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.3 + i * 0.008 }}
            >
              {w}
              {i < words.length - 1 ? ' ' : ''}
            </motion.span>
          ))}
        </p>
      </div>

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.35, ease: 'easeOut' }}
        className="shrink-0 text-right"
      >
        <motion.div
          animate={anyError && !reduce ? { x: [0, -3, 3, -3, 3, 0] } : undefined}
          transition={{ duration: 0.3 }}
          className="font-data text-[24px] font-bold leading-7 tabular-nums"
          style={{ color: healthColor, textShadow: `0 0 10px ${healthColor}55` }}
        >
          SOURCES {live}/{REGISTRY.length} LIVE
        </motion.div>
        <div className="mt-1 font-data text-[11px] uppercase tabular-nums text-wf-ink-faint">
          Last global refresh {ageLabel(lastGlobal, now)} ago
        </div>
        <div className="mt-2 font-data text-[10px] uppercase text-wf-ink-faint">
          {REGISTRY.filter((r) => r.key && derivedStatus(state[r.key], now) === 'stale').length > 0 &&
            `${REGISTRY.filter((r) => r.key && derivedStatus(state[r.key], now) === 'stale').length} stale · `}
          {REGISTRY.filter((r) => r.key && state[r.key].status === 'error').length > 0 &&
            `${REGISTRY.filter((r) => r.key && state[r.key].status === 'error').length} error`}
        </div>
      </motion.div>
    </div>
  );
}
