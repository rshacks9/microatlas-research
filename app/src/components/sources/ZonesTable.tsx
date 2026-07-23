/**
 * ZonesTable — sources.md §4. The 20 curated flashpoint zones with live
 * tension scores from the engine, sorted by score. Score/level cells
 * flash cyan 600ms on each real recompute. Centroids/radii are the
 * hand-curated reference overlay — stated plainly in the note.
 */

import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import HudFrame from '@/components/HudFrame';
import { useSlice } from '@/store/useLiveStore';
import { CONFLICT_ZONES } from '@/lib/zones';
import { LEVEL_COLORS } from '@/lib/tension';
import type { ZoneScore } from '@/lib/tension';

function fmtCoord(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
}

export default function ZonesTable() {
  const tension = useSlice('tension');
  const reduce = useReducedMotion();

  /* cyan flash on recompute */
  const prevRun = useRef<number | null>(tension.lastFetch);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prevRun.current !== null && tension.lastFetch !== null && tension.lastFetch !== prevRun.current) {
      setFlash(true);
      const t = window.setTimeout(() => setFlash(false), 650);
      return () => window.clearTimeout(t);
    }
    prevRun.current = tension.lastFetch;
  }, [tension.lastFetch]);

  const rows = CONFLICT_ZONES.map((z) => ({ zone: z, score: tension.data.zones[z.id] as ZoneScore | undefined })).sort(
    (a, b) => (b.score?.score ?? -1) - (a.score?.score ?? -1),
  );

  return (
    <section className="mt-16">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-[20px] font-semibold leading-[26px] tracking-[0.08em] text-wf-ink">
          FLASHPOINT REFERENCE OVERLAY
        </h2>
        <span className="font-data text-[10px] uppercase text-wf-ink-faint">
          {tension.data.scored}/{CONFLICT_ZONES.length} zones scored live
        </span>
      </div>
      <p className="mt-2 max-w-[720px] font-body text-xs leading-5 text-wf-ink-dim">
        Zone centroids and radii are a hand-curated reference overlay; all scores and headlines on
        them are live.
      </p>

      <motion.div
        initial={reduce ? false : { opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.1 }}
        transition={{ duration: 0.5 }}
        className="mt-4"
      >
        <HudFrame className="overflow-x-auto p-0">
          <table className="w-full min-w-[880px] border-collapse font-data text-[12px]">
            <thead>
              <tr className="border-b border-wf-line text-left text-[10px] uppercase tracking-[0.08em] text-wf-ink-faint">
                <th className="px-3 py-2.5 font-medium">Zone</th>
                <th className="px-3 py-2.5 font-medium">Region</th>
                <th className="px-3 py-2.5 font-medium">Centroid</th>
                <th className="px-3 py-2.5 font-medium">Radius km</th>
                <th className="px-3 py-2.5 font-medium">GDELT query</th>
                <th className="px-3 py-2.5 text-right font-medium">Live score</th>
                <th className="px-3 py-2.5 font-medium">Level</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ zone, score }, i) => {
                const lc = score ? LEVEL_COLORS[score.level] : 'var(--ink-faint)';
                return (
                  <motion.tr
                    key={zone.id}
                    initial={reduce ? false : { opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true, amount: 0.5 }}
                    transition={{ duration: 0.3, delay: Math.min(i, 12) * 0.02 }}
                    className="border-b border-wf-line/50 last:border-0 hover:bg-bg-3/40"
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-display text-[12px] font-medium tracking-[0.04em] text-wf-ink">
                      {zone.name}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-wf-ink-dim">{zone.region}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-wf-ink-dim">
                      {fmtCoord(zone.centroid[0], zone.centroid[1])}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-wf-ink-dim">{zone.radiusKm}</td>
                    <td className="max-w-[280px] px-3 py-2">
                      <span className="block truncate text-[11px] text-wf-ink-faint" title={zone.gdeltQuery}>
                        {zone.gdeltQuery}
                      </span>
                    </td>
                    <motion.td
                      animate={flash && !reduce ? { color: ['#2EE6C8', '#D7E6EF'] } : undefined}
                      transition={{ duration: 0.6 }}
                      className="px-3 py-2 text-right text-[13px] font-bold tabular-nums"
                      style={{ color: score ? lc : 'var(--ink-faint)' }}
                    >
                      {score ? score.score.toFixed(1) : '——'}
                    </motion.td>
                    <td className="px-3 py-2">
                      <span
                        className="inline-block border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em]"
                        style={{ color: lc, borderColor: score ? `${lc}44` : 'var(--line)' }}
                      >
                        {score ? score.level : 'SYNC'}
                      </span>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </HudFrame>
      </motion.div>
    </section>
  );
}
