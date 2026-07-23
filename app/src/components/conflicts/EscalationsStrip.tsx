/**
 * EscalationsStrip (conflicts.md §5) — marquee of zones whose tension
 * score moved since the previous engine computation: ▲ red (rising),
 * ▼ green dimmed (falling). Honest empty state when nothing moved.
 * Auto-scrolls ~24px/s, pauses on hover, static under reduced motion.
 */

import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import HudFrame from '@/components/HudFrame';
import { CONFLICT_ZONES } from '@/lib/zones';
import type { TensionData } from '@/store/useLiveStore';
import { formatUtc } from './coverageStore';

interface DeltaRow {
  id: string;
  name: string;
  delta: number;
}

export default function EscalationsStrip({ tension }: { tension: TensionData }) {
  const reduce = useReducedMotion();

  const rows = useMemo<DeltaRow[]>(() => {
    return CONFLICT_ZONES.map((z) => ({ id: z.id, name: z.name, delta: tension.zones[z.id]?.delta ?? 0 }))
      .filter((r) => r.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }, [tension.zones]);

  const lastComputed = useMemo(() => {
    const ts = Object.values(tension.zones).map((z) => z.computedAt);
    return ts.length ? Math.max(...ts) : null;
  }, [tension.zones]);

  const rising = rows.filter((r) => r.delta > 0);

  // ~24px/s: estimate 190px per chip
  const duration = Math.max(20, (rows.length * 190) / 24);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <HudFrame className="overflow-hidden">
        <div className="flex items-center border-b border-wf-line px-3 py-2">
          <span className="font-display text-[11px] font-medium uppercase tracking-[0.14em] text-wf-ink-dim">
            Escalations <span className="text-wf-ink-faint">// last re-score</span>
          </span>
          <span className="ml-auto font-data text-[10px] tabular-nums text-wf-ink-faint">
            {lastComputed ? formatUtc(lastComputed) : 'AWAITING FIRST COMPUTATION'}
          </span>
        </div>
        {rows.length === 0 ? (
          <div className="px-3 py-3 font-data text-[10px] uppercase tracking-[0.08em] text-wf-ink-faint">
            No significant deltas since last computation · {lastComputed ? formatUtc(lastComputed) : 'engine warming up'}
          </div>
        ) : (
          <div className="relative flex overflow-hidden py-2.5" aria-label={`${rising.length} zones escalating`}>
            <div
              className={`flex shrink-0 items-center gap-2 pr-2 ${reduce ? '' : 'wf-anim-marquee hover:[animation-play-state:paused]'}`}
              style={{ '--wf-marquee-dur': `${duration}s` } as CSSProperties}
            >
              {[0, 1].map((dup) => (
                <div key={dup} className="flex shrink-0 items-center gap-2" aria-hidden={dup === 1}>
                  {rows.map((r) => {
                    const up = r.delta > 0;
                    return (
                      <span
                        key={`${dup}-${r.id}`}
                        className={`flex items-center gap-1.5 whitespace-nowrap border px-2 py-1 font-data text-[10px] tabular-nums ${
                          up ? 'border-wf-red/40 text-wf-red' : 'border-wf-line text-wf-green opacity-50'
                        }`}
                      >
                        {r.name}
                        <span>
                          {up ? '▲' : '▼'}
                          {Math.abs(r.delta).toFixed(1)}
                        </span>
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </HudFrame>
    </motion.div>
  );
}
