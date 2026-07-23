/**
 * PageHeader (conflicts.md §1) — eyebrow + char-staggered H1 + honesty
 * sub + live readout stack (zones tracked, global tension, engine age).
 */

import { motion, useReducedMotion } from 'framer-motion';
import StatusChip from '@/components/StatusChip';
import { CONFLICT_ZONES } from '@/lib/zones';
import { LEVEL_COLORS, levelFor } from '@/lib/tension';
import type { Slice, TensionData } from '@/store/useLiveStore';
import CountUp from './CountUp';

const H1 = 'FLASHPOINTS, SCORED IN REAL TIME';

function StaggeredHeadline() {
  const reduce = useReducedMotion();
  if (reduce) {
    return (
      <h1 className="mt-3 max-w-[720px] font-display text-[40px] font-bold leading-[44px] tracking-[0.08em] text-wf-ink">
        {H1}
      </h1>
    );
  }
  const words = H1.split(' ');
  let charIndex = 0;
  return (
    <h1
      className="mt-3 max-w-[720px] font-display text-[40px] font-bold leading-[44px] tracking-[0.08em] text-wf-ink"
      aria-label={H1}
    >
      {words.map((word, wi) => (
        <span key={wi} className="inline-block whitespace-nowrap">
          {word.split('').map((ch, ci) => {
            const delay = Math.min(charIndex++ * 0.015, 0.6);
            return (
              <motion.span
                key={ci}
                aria-hidden
                className="inline-block"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
              >
                {ch}
              </motion.span>
            );
          })}
          {wi < words.length - 1 && <span aria-hidden>&nbsp;</span>}
        </span>
      ))}
    </h1>
  );
}

export default function PageHeader({ tension }: { tension: Slice<TensionData> }) {
  const global = tension.data.global;
  const globalLevel = global != null ? levelFor(global) : null;
  const globalColor = globalLevel ? LEVEL_COLORS[globalLevel] : 'var(--ink-faint)';

  return (
    <header className="flex flex-wrap items-start justify-between gap-8 pt-16">
      <div className="min-w-[300px] flex-1">
        <motion.div
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="flex items-center gap-2 font-display text-[11px] font-medium uppercase tracking-[0.14em] text-wf-ink-dim"
        >
          <span className="inline-block h-2 w-2 rounded-full bg-wf-red wf-anim-blink" style={{ boxShadow: '0 0 6px #FF3B47' }} />
          Conflict Monitor
        </motion.div>

        <StaggeredHeadline />

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-4 max-w-[640px] font-body text-[14px] leading-5 text-wf-ink-dim"
        >
          {CONFLICT_ZONES.length} active conflict and flashpoint regions, continuously re-scored from GDELT
          global news volume and tone. Derived instability indicators from real-time signals — not forecasts
          of certainty.
        </motion.p>
      </div>

      {/* readout stack */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="flex gap-8"
      >
        <div>
          <div className="font-display text-[11px] font-medium uppercase tracking-[0.14em] text-wf-ink-faint">
            Zones tracked
          </div>
          <CountUp value={CONFLICT_ZONES.length} duration={0.8} className="mt-1 block font-data text-[24px] font-bold leading-7 text-wf-ink" />
        </div>
        <div>
          <div className="font-display text-[11px] font-medium uppercase tracking-[0.14em] text-wf-ink-faint">
            Global tension
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            {global != null ? (
              <>
                <CountUp value={global} duration={0.8} decimals={1} className="font-data text-[24px] font-bold leading-7 text-glow" style={{ color: globalColor }} />
                <span className="font-data text-[11px] uppercase tracking-[0.08em]" style={{ color: globalColor }}>
                  {globalLevel}
                </span>
              </>
            ) : (
              <span className="font-data text-[24px] font-bold leading-7 text-wf-ink-faint">—.—</span>
            )}
          </div>
          <div className="mt-1 font-data text-[9px] uppercase tracking-[0.08em] text-wf-ink-faint">
            mean of top-5 zone scores
          </div>
        </div>
        <div>
          <div className="font-display text-[11px] font-medium uppercase tracking-[0.14em] text-wf-ink-faint">
            Engine updated
          </div>
          <StatusChip slice={tension} label="" className="mt-2" />
          <div className="mt-1 font-data text-[9px] uppercase tracking-[0.08em] text-wf-ink-faint">
            scored {tension.data.scored}/{tension.data.total || CONFLICT_ZONES.length} zones
          </div>
        </div>
      </motion.div>
    </header>
  );
}
