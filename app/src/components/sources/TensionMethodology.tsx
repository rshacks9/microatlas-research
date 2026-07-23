/**
 * TensionMethodology — sources.md §3. Four-step pipeline (mono-numbered
 * circles, dashed connector) plus the amber caveat panel with a live
 * COMPUTED / NEXT countdown chip. All timing values come from the real
 * tension slice.
 */

import { motion, useReducedMotion } from 'framer-motion';
import HudFrame from '@/components/HudFrame';
import { useSlice } from '@/store/useLiveStore';
import { CADENCE } from '@/lib/sources';
import { useNow } from '@/components/intel/wire';

const STEPS: Array<{ id: string; body: string }> = [
  {
    id: 'SIGNAL',
    body: 'For each of 20 curated flashpoint zones, fetch GDELT timelinevol + timelinetone (7-day window) with a zone-specific query.',
  },
  {
    id: 'BASELINE',
    body: 'Compute 7-day mean/std of daily volume as the zone’s own baseline.',
  },
  {
    id: 'SCORE',
    body: 'Volume z-score (weight 0.65) + tone delta vs baseline (weight 0.35) → normalized 0–100.',
  },
  {
    id: 'LEVEL',
    body: 'Map to LOW / GUARDED / ELEVATED / HIGH / CRITICAL bands; global index = mean of top-5 zone scores.',
  },
];

function utcStamp(ms: number | null): string {
  if (ms == null) return '——';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
}

export default function TensionMethodology() {
  const tension = useSlice('tension');
  const now = useNow();
  const reduce = useReducedMotion();

  const computedAt = tension.lastFetch;
  const nextIn =
    tension.lastFetch != null ? Math.round((tension.lastFetch + CADENCE.tension - now) / 1000) : null;

  return (
    <section className="mt-16 grid gap-8 lg:grid-cols-2">
      {/* left — pipeline */}
      <div>
        <h2 className="font-display text-[24px] font-semibold leading-[30px] tracking-[0.08em] text-wf-ink">
          HOW THE TENSION INDEX WORKS
        </h2>
        <div className="mt-6 space-y-0">
          {STEPS.map((s, i) => (
            <motion.div
              key={s.id}
              initial={reduce ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.4, delay: i * 0.12, ease: 'easeOut' }}
              className="relative flex gap-4 pb-6 last:pb-0"
            >
              {/* dashed connector */}
              {i < STEPS.length - 1 && (
                <span className="absolute left-[15px] top-8 h-[calc(100%-32px)] border-l border-dashed border-wf-line" aria-hidden />
              )}
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-wf-line bg-bg-1 font-data text-[11px] font-bold text-wf-cyan">
                {i + 1}
              </span>
              <div>
                <div className="font-display text-[13px] font-semibold uppercase tracking-[0.1em] text-wf-ink">
                  {s.id}
                </div>
                <p className="mt-1 max-w-[480px] font-body text-[13px] leading-5 text-wf-ink-dim">{s.body}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* right — caveat panel */}
      <motion.div
        initial={reduce ? false : { opacity: 0, x: 24 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
      >
        <HudFrame className="border-wf-amber/40 p-5" style={{ borderColor: 'rgba(255,176,32,0.4)' }}>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-wf-amber" style={{ boxShadow: '0 0 8px #FFB020' }} />
            <span className="font-display text-[17px] font-semibold uppercase tracking-[0.08em] text-wf-amber">
              Read this
            </span>
          </div>
          <p className="mt-3 font-body text-sm leading-6 text-wf-ink">
            This is a media-attention instability indicator derived from real-time GDELT signals.
            Coverage volume reflects press attention as well as events. It is not intelligence
            assessment and not a forecast of certainty. Weights and bands are fixed, documented
            here, and applied uniformly.
          </p>
          <div className="mt-4 inline-flex flex-wrap items-center gap-x-3 gap-y-1 border border-wf-line px-2.5 py-1.5 font-data text-[10px] uppercase tabular-nums text-wf-ink-dim">
            <span>Computed {utcStamp(computedAt)}</span>
            <span className="text-wf-ink-faint">·</span>
            <span>
              Next {nextIn == null ? '——' : nextIn > 0 ? `${nextIn}s` : 'due'}
            </span>
            <span className="text-wf-ink-faint">·</span>
            <span>
              {tension.data.scored}/{tension.data.total || 20} zones scored
            </span>
          </div>
        </HudFrame>
      </motion.div>
    </section>
  );
}
