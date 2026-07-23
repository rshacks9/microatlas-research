/**
 * NaturalEvents — intel.md §4. Two panels: NASA EONET open events and
 * USGS M2.5+ earthquakes (24h), straight from the live store slices.
 * New earthquakes enter with an amber flash; M≥5 blocks pulse once.
 * Coordinates shown are the last-received event geometry (real).
 */

import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  CloudRain,
  Flame,
  Mountain,
  Snowflake,
  Thermometer,
  Waves,
  Wind,
  ExternalLink,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import HudFrame from '@/components/HudFrame';
import StatusChip from '@/components/StatusChip';
import { useSlice } from '@/store/useLiveStore';
import type { NaturalEvent } from '@/store/useLiveStore';
import { utcDate, utcHM, useNow } from './wire';

const CATEGORY_ICONS: Array<[RegExp, LucideIcon]> = [
  [/wildfire/i, Flame],
  [/storm|cyclone|typhoon|hurricane/i, Wind],
  [/flood|water/i, Waves],
  [/ice|snow|avalanche/i, Snowflake],
  [/volcano/i, Mountain],
  [/earthquake/i, Activity],
  [/drought|temperature/i, Thermometer],
  [/dust|haze|landslide/i, CloudRain],
];

function categoryIcon(category: string): LucideIcon {
  for (const [re, icon] of CATEGORY_ICONS) if (re.test(category)) return icon;
  return Activity;
}

function magColor(m: number | null): string {
  if (m == null) return 'var(--ink-dim)';
  if (m >= 6) return '#FF3B47';
  if (m >= 5) return '#FFB020';
  if (m >= 4) return '#4EA8FF';
  return 'var(--ink-dim)';
}

/** Tracks ids seen previously so arrivals can flash in. */
function useArrivals(events: NaturalEvent[]): Set<string> {
  const known = useRef<Set<string> | null>(null);
  const [arrivals, setArrivals] = useState<Set<string>>(new Set());
  useEffect(() => {
    const ids = new Set(events.map((e) => e.id));
    if (known.current === null) {
      known.current = ids;
      return;
    }
    const fresh = new Set([...ids].filter((id) => !known.current!.has(id)));
    known.current = ids;
    if (fresh.size > 0) {
      setArrivals(fresh);
      const t = window.setTimeout(() => setArrivals(new Set()), 900);
      return () => window.clearTimeout(t);
    }
  }, [events]);
  return arrivals;
}

function ErrorRow({ error }: { error: string | null }) {
  return (
    <div className="p-4 font-data text-[11px] uppercase text-wf-red">
      Feed error — {error ?? 'unknown'} · retrying on next poll
    </div>
  );
}

function EonetPanel() {
  const slice = useSlice('eonet');
  const reduce = useReducedMotion();
  return (
    <HudFrame className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-wf-line px-4 py-3">
        <span className="font-display text-[13px] font-semibold uppercase tracking-[0.08em] text-wf-ink">
          EONET · Open Events
        </span>
        <StatusChip slice={slice} label="NASA" />
      </div>
      <div className="max-h-[400px] min-h-0 overflow-y-auto">
        {slice.status === 'error' && <ErrorRow error={slice.error} />}
        {slice.status !== 'error' && slice.data.length === 0 && (
          <div className="p-4 font-data text-[11px] uppercase text-wf-ink-faint">
            {slice.status === 'loading' || slice.status === 'idle' ? 'Acquiring EONET feed…' : 'No open events reported'}
          </div>
        )}
        {slice.data.map((e, i) => {
          const Icon = categoryIcon(e.category);
          return (
            <motion.div
              key={e.id}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.3, delay: Math.min(i, 10) * 0.03 }}
              className="flex items-center gap-3 border-b border-wf-line/50 px-4 py-2.5 last:border-0 hover:bg-bg-3/50"
            >
              <Icon className="h-4 w-4 shrink-0 text-wf-violet" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-[13px] font-medium text-wf-ink">{e.title}</div>
                <div className="font-data text-[10px] uppercase text-wf-ink-faint">
                  {e.category} · {utcDate(e.timeMs)}
                </div>
              </div>
              <a
                href={`/?event=${encodeURIComponent(e.id)}`}
                className="shrink-0 font-data text-[10px] uppercase text-wf-ink-dim hover:text-wf-cyan"
                title="Focus this event on the deck globe"
              >
                Map →
              </a>
            </motion.div>
          );
        })}
      </div>
    </HudFrame>
  );
}

function UsgsPanel() {
  const slice = useSlice('usgs');
  const reduce = useReducedMotion();
  const arrivals = useArrivals(slice.data);
  useNow(30_000);
  const sorted = [...slice.data].sort((a, b) => (b.timeMs ?? 0) - (a.timeMs ?? 0));

  return (
    <HudFrame className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-wf-line px-4 py-3">
        <span className="font-display text-[13px] font-semibold uppercase tracking-[0.08em] text-wf-ink">
          USGS Earthquakes
        </span>
        <div className="flex items-center gap-3">
          <span className="font-data text-[10px] uppercase text-wf-ink-faint">Mag ≥ 2.5 · Last 24h</span>
          <StatusChip slice={slice} label="USGS" />
        </div>
      </div>
      <div className="max-h-[400px] min-h-0 overflow-y-auto">
        {slice.status === 'error' && <ErrorRow error={slice.error} />}
        {slice.status !== 'error' && sorted.length === 0 && (
          <div className="p-4 font-data text-[11px] uppercase text-wf-ink-faint">
            {slice.status === 'loading' || slice.status === 'idle' ? 'Acquiring USGS feed…' : 'No M2.5+ earthquakes in window'}
          </div>
        )}
        {sorted.map((e, i) => {
          const isNew = arrivals.has(e.id);
          const big = (e.magnitude ?? 0) >= 5;
          return (
            <motion.div
              key={e.id}
              layout="position"
              initial={reduce ? false : { opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.3, delay: Math.min(i, 10) * 0.03 }}
            >
              <motion.div
                animate={isNew && !reduce ? { backgroundColor: ['rgba(255,176,32,0.14)', 'rgba(255,176,32,0)'] } : undefined}
                transition={{ duration: 0.8 }}
                className="flex items-center gap-3 border-b border-wf-line/50 px-4 py-2.5 last:border-0 hover:bg-bg-3/50"
              >
                <motion.div
                  animate={isNew && big && !reduce ? { scale: [1, 1.08, 1] } : undefined}
                  transition={{ duration: 0.4 }}
                  className="w-12 shrink-0 text-center font-data text-[24px] font-bold leading-7 tabular-nums"
                  style={{ color: magColor(e.magnitude) }}
                >
                  {e.magnitude != null ? e.magnitude.toFixed(1) : '——'}
                </motion.div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-[13px] font-medium text-wf-ink">{e.title}</div>
                  <div className="font-data text-[10px] uppercase tabular-nums text-wf-ink-faint">
                    {e.lat.toFixed(2)}°{e.lat >= 0 ? 'N' : 'S'} {Math.abs(e.lon).toFixed(2)}°{e.lon >= 0 ? 'E' : 'W'} · {utcHM(e.timeMs)} UTC
                  </div>
                </div>
                <a
                  href={`/?event=${encodeURIComponent(e.id)}`}
                  className="shrink-0 font-data text-[10px] uppercase text-wf-ink-dim hover:text-wf-cyan"
                  title="Focus this earthquake on the deck globe"
                >
                  Map →
                </a>
                {e.url && (
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex shrink-0 items-center gap-1 font-data text-[10px] uppercase text-wf-ink-dim hover:text-wf-cyan"
                  >
                    USGS <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </motion.div>
            </motion.div>
          );
        })}
      </div>
    </HudFrame>
  );
}

export default function NaturalEvents() {
  const reduce = useReducedMotion();
  return (
    <section className="mt-16">
      <motion.div
        initial={reduce ? false : { opacity: 0, x: -12 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.4 }}
        className="flex items-center gap-2"
      >
        <span className="inline-block h-2 w-2 rounded-full bg-wf-violet" style={{ boxShadow: '0 0 8px #9B8CFF' }} />
        <h2 className="font-display text-[20px] font-semibold leading-[26px] tracking-[0.08em] text-wf-ink">
          NATURAL EVENTS // OPEN
        </h2>
      </motion.div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        >
          <EonetPanel />
        </motion.div>
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
        >
          <UsgsPanel />
        </motion.div>
      </div>
    </section>
  );
}
