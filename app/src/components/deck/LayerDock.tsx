/**
 * LayerDock — left panel (288px, collapsible to 40px rail).
 * Layer toggle rows with live counts + per-layer status dots,
 * TENSION ENGINE mini-module (global readout + sparkline),
 * PROVENANCE button at the foot.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import HudFrame from '@/components/HudFrame';
import { useLiveState, useLayers, layerStore, LAYER_COLORS } from '@/store/useLiveStore';
import type { LayerKey, SourceKey } from '@/store/useLiveStore';
import { LEVEL_COLORS, levelFor } from '@/lib/tension';

const ROWS: Array<{ key: LayerKey; label: string; slice: SourceKey | null }> = [
  { key: 'satellites', label: 'SATELLITES', slice: 'tle' },
  { key: 'aircraft', label: 'AIRCRAFT', slice: 'aircraft' },
  { key: 'ships', label: 'SHIPS', slice: 'ships' },
  { key: 'conflictZones', label: 'CONFLICT ZONES', slice: 'tension' },
  { key: 'tensionHeat', label: 'TENSION HEAT', slice: 'tension' },
  { key: 'newsMarkers', label: 'NEWS MARKERS', slice: 'news' },
  { key: 'naturalEvents', label: 'NATURAL EVENTS', slice: 'eonet' },
  { key: 'dayNight', label: 'DAY-NIGHT', slice: null },
  { key: 'graticule', label: 'GRATICULE', slice: null },
];

function countFor(key: LayerKey, state: ReturnType<typeof useLiveState>): number | null {
  switch (key) {
    case 'satellites':
      return state.tle.records;
    case 'aircraft':
      return state.aircraft.records;
    case 'ships':
      return state.ships.records;
    case 'conflictZones':
      return 24;
    case 'tensionHeat':
      return state.tension.data.scored || null;
    case 'newsMarkers':
      return state.news.records;
    case 'naturalEvents':
      return state.eonet.records + state.usgs.records;
    default:
      return null;
  }
}

function Sparkline({ history }: { history: Array<{ t: number; v: number }> }) {
  if (history.length < 2) {
    return <div className="flex h-[20px] items-center font-data text-[10px] text-wf-ink-faint">COLLECTING BASELINE…</div>;
  }
  const w = 240;
  const h = 20;
  const vs = history.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || 1;
  const pts = history
    .map((p, i) => `${(i / (history.length - 1)) * w},${h - ((p.v - min) / span) * (h - 2) - 1}`)
    .join(' ');
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block">
      <polyline points={pts} fill="none" stroke="var(--cyan)" strokeWidth="1" opacity="0.8" />
    </svg>
  );
}

export default function LayerDock({ onOpenProvenance }: { onOpenProvenance: () => void }) {
  const state = useLiveState();
  const layers = useLayers();
  const [collapsed, setCollapsed] = useState(false);

  const tension = state.tension.data.global;
  const level = tension != null ? levelFor(tension) : null;

  return (
    <motion.div
      initial={false}
      animate={{ width: collapsed ? 40 : 288 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="pointer-events-auto absolute bottom-12 left-3 top-16 z-30 overflow-hidden"
    >
      <HudFrame className="flex h-full flex-col">
        {/* header */}
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-wf-line px-3">
          {!collapsed && (
            <span className="font-display text-[11px] font-medium uppercase tracking-[0.14em] text-wf-ink-dim">Layers</span>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="text-wf-ink-dim hover:text-wf-cyan"
            aria-label={collapsed ? 'Expand layers' : 'Collapse layers'}
          >
            {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
          </button>
        </div>

        {collapsed ? (
          <div className="flex flex-col items-center gap-3 py-3">
            {ROWS.map((r) => (
              <button
                key={r.key}
                onClick={() => layerStore.toggle(r.key)}
                title={r.label}
                className="h-2.5 w-2.5 rounded-full transition-transform hover:scale-125"
                style={{ backgroundColor: LAYER_COLORS[r.key], opacity: layers[r.key] ? 1 : 0.25 }}
              />
            ))}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* rows */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {ROWS.map((r, i) => {
                const count = countFor(r.key, state);
                const slice = r.slice ? state[r.slice] : null;
                const status = slice ? slice.status : 'live';
                return (
                  <motion.div
                    key={r.key}
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.05 * i, duration: 0.3 }}
                    className="flex h-9 items-center gap-2.5 border-b border-wf-line/50 px-3"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: LAYER_COLORS[r.key] }} />
                    <span className="font-display text-[11px] font-medium tracking-[0.08em] text-wf-ink">{r.label}</span>
                    <span className="flex-1" />
                    {count != null && (
                      <span className="font-data text-[10px] tabular-nums text-wf-ink-dim">{count.toLocaleString()}</span>
                    )}
                    {/* toggle */}
                    <button
                      onClick={() => layerStore.toggle(r.key)}
                      aria-label={`Toggle ${r.label}`}
                      className={`relative h-3.5 w-7 shrink-0 border transition-colors duration-120 ${
                        layers[r.key] ? 'border-wf-cyan/50 bg-wf-cyan/20' : 'border-wf-line bg-bg-1'
                      }`}
                    >
                      <span
                        className={`absolute top-[1px] h-2.5 w-2.5 transition-all duration-120 ${
                          layers[r.key] ? 'left-[15px] bg-wf-cyan' : 'left-[1px] bg-wf-ink-faint'
                        }`}
                      />
                    </button>
                    {/* status dot */}
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      title={slice?.error ?? status}
                      style={{
                        backgroundColor:
                          status === 'live' ? '#3DF58A' : status === 'error' ? '#FF3B47' : status === 'stale' ? '#FFB020' : '#3A4B59',
                      }}
                    />
                  </motion.div>
                );
              })}
            </div>

            {/* tension engine mini-module */}
            <div className="shrink-0 border-t border-wf-line px-3 py-3">
              <div className="font-display text-[10px] font-medium uppercase tracking-[0.14em] text-wf-ink-faint">
                Tension Engine
              </div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span
                  className="font-data text-2xl font-bold leading-7 tabular-nums"
                  style={{ color: level ? LEVEL_COLORS[level] : 'var(--ink-faint)' }}
                >
                  {tension != null ? tension.toFixed(1) : '——'}
                </span>
                <span className="font-data text-[10px] uppercase" style={{ color: level ? LEVEL_COLORS[level] : 'var(--ink-faint)' }}>
                  {level ?? 'SYNCING'}
                </span>
              </div>
              <div className="mt-1.5">
                <Sparkline history={state.tension.data.history} />
              </div>
              <div className="mt-1 font-body text-[10px] leading-3 text-wf-ink-faint">
                DERIVED FROM GDELT · NOT A FORECAST
              </div>
            </div>

            {/* provenance */}
            <button
              onClick={onOpenProvenance}
              className="flex h-9 shrink-0 items-center border-t border-wf-line px-3 font-data text-[11px] uppercase tracking-[0.08em] text-wf-cyan hover:bg-bg-3"
            >
              Provenance ▸
            </button>
          </div>
        )}
      </HudFrame>
    </motion.div>
  );
}
