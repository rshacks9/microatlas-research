/**
 * WatchlistRail — right panel (288px, collapsible). Top-8 zones by live
 * tension score with bars + Δ arrows; click flies globe to the zone.
 * NOW MONITORING audio chip when a radio feed is playing.
 */

import { useState } from 'react';
import { Link } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronsLeft, ChevronsRight, Square } from 'lucide-react';
import HudFrame from '@/components/HudFrame';
import StatusChip from '@/components/StatusChip';
import { useLiveState, liveStore } from '@/store/useLiveStore';
import { CONFLICT_ZONES } from '@/lib/zones';
import { LEVEL_COLORS } from '@/lib/tension';

function EqBars() {
  return (
    <span className="flex h-[14px] items-end gap-[2px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[3px] bg-wf-green"
          style={{ animation: `wf-eq 0.5s ease-in-out ${i * 0.15}s infinite` }}
        />
      ))}
    </span>
  );
}

export default function WatchlistRail({
  onFlyToZone,
}: {
  onFlyToZone: (zoneId: string) => void;
}) {
  const state = useLiveState();
  const [collapsed, setCollapsed] = useState(false);

  const zones = state.tension.data.zones;
  const ranked = CONFLICT_ZONES.map((z) => ({ zone: z, score: zones[z.id] }))
    .filter((r) => r.score)
    .sort((a, b) => b.score!.score - a.score!.score)
    .slice(0, 8);

  const playing = state.radio.data.nowPlaying;

  return (
    <motion.div
      initial={false}
      animate={{ width: collapsed ? 40 : 288 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="pointer-events-auto absolute bottom-12 right-3 top-16 z-30 overflow-hidden"
    >
      <HudFrame className="flex h-full flex-col">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-wf-line px-3">
          {!collapsed && (
            <>
              <span className="font-display text-[11px] font-medium uppercase tracking-[0.14em] text-wf-ink-dim">
                Watchlist // Top Tension
              </span>
              <StatusChip slice={state.tension} showAge={false} />
            </>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="text-wf-ink-dim hover:text-wf-cyan"
            aria-label={collapsed ? 'Expand watchlist' : 'Collapse watchlist'}
          >
            {collapsed ? <ChevronsLeft size={14} /> : <ChevronsRight size={14} />}
          </button>
        </div>

        {!collapsed && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              {ranked.length === 0 && (
                <div className="px-3 py-4 font-data text-[11px] text-wf-ink-faint">
                  {state.tension.status === 'error'
                    ? `TENSION ENGINE ERROR — ${state.tension.error ?? ''}`
                    : 'SCORING ZONES VIA GDELT…'}
                </div>
              )}
              <AnimatePresence initial={false}>
                {ranked.map(({ zone, score }, i) => {
                  const s = score!;
                  const color = LEVEL_COLORS[s.level];
                  return (
                    <motion.button
                      key={zone.id}
                      layout="position"
                      initial={{ opacity: 0, x: 24 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ delay: 0.06 * i, duration: 0.35 }}
                      onClick={() => onFlyToZone(zone.id)}
                      className="flex w-full flex-col gap-1 border-b border-wf-line/50 px-3 py-2 text-left hover:bg-bg-3"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-data text-[10px] tabular-nums text-wf-ink-faint">{String(i + 1).padStart(2, '0')}</span>
                        <span className="font-display text-xs font-medium tracking-[0.06em] text-wf-ink">{zone.name}</span>
                        <span className="flex-1" />
                        <span className="font-data text-[11px] tabular-nums" style={{ color }}>
                          {s.score.toFixed(1)}
                        </span>
                        {s.delta !== 0 && (
                          <span
                            className="font-data text-[10px] tabular-nums"
                            style={{ color: s.delta > 0 ? '#FF3B47' : '#3DF58A' }}
                          >
                            {s.delta > 0 ? '▲' : '▼'} {Math.abs(s.delta).toFixed(1)}
                          </span>
                        )}
                      </div>
                      <div className="ml-6 h-[2px] bg-wf-line/60">
                        <motion.div
                          className="h-[2px]"
                          style={{ backgroundColor: color }}
                          initial={false}
                          animate={{ width: `${s.score}%` }}
                          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
                        />
                      </div>
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            </div>

            <Link
              to="/conflicts"
              className="flex h-9 shrink-0 items-center border-t border-wf-line px-3 font-data text-[11px] uppercase tracking-[0.08em] text-wf-cyan hover:bg-bg-3"
            >
              All 24 zones →
            </Link>

            {/* now monitoring */}
            <div className="shrink-0 border-t border-wf-line px-3 py-2.5">
              <div className="font-display text-[10px] font-medium uppercase tracking-[0.14em] text-wf-ink-faint">
                Now Monitoring
              </div>
              {playing ? (
                <div className="mt-1.5 flex items-center gap-2">
                  <EqBars />
                  <span className="truncate font-data text-[11px] text-wf-ink">{playing.name}</span>
                  <span className="flex-1" />
                  <button
                    onClick={() => liveStore.patch('radio', { data: { nowPlaying: null } })}
                    className="text-wf-red hover:text-wf-ink"
                    aria-label="Stop feed"
                  >
                    <Square size={12} />
                  </button>
                </div>
              ) : (
                <div className="mt-1.5 font-data text-[10px] text-wf-ink-faint">
                  NO LIVE FEED — <Link to="/signals" className="text-wf-cyan hover:underline">OPEN SIGNALS →</Link>
                </div>
              )}
            </div>
          </div>
        )}
      </HudFrame>
    </motion.div>
  );
}
