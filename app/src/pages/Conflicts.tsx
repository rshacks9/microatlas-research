/**
 * Conflict Monitor (/conflicts) — ranked flashpoint watchlist scored live
 * by the GDELT tension engine (conflicts.md). Every score, sparkline,
 * headline and count is real: tension engine via useLiveStore, per-zone
 * GDELT artlist via the shared 6s queue (coverageStore), sparklines from
 * cached engine recomputes (zoneHistory). NO MOCK DATA — loading, empty,
 * stale and error states are explicit.
 *
 * Indicator label (global contract): "Derived instability indicator —
 * not a forecast of certainty."
 */

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import HudFrame from '@/components/HudFrame';
import { useSlice } from '@/store/useLiveStore';
import { CONFLICT_ZONES } from '@/lib/zones';
import type { ConflictZone } from '@/lib/zones';
import { LEVEL_COLORS } from '@/lib/tension';
import type { TensionLevel, ZoneScore } from '@/lib/tension';
import PageHeader from '@/components/conflicts/PageHeader';
import MethodologyBanner from '@/components/conflicts/MethodologyBanner';
import ZoneCard from '@/components/conflicts/ZoneCard';
import ZoneDetailModal from '@/components/conflicts/ZoneDetailModal';
import EscalationsStrip from '@/components/conflicts/EscalationsStrip';
import FreshnessBand from '@/components/conflicts/FreshnessBand';
import { appendZoneScores, zoneDelta } from '@/components/conflicts/zoneHistory';
import type { HistoryPoint } from '@/components/conflicts/zoneHistory';
import { ensureCoverageStarted, useCoverageMap } from '@/components/conflicts/coverageStore';

const LEVELS: TensionLevel[] = ['CRITICAL', 'HIGH', 'ELEVATED', 'GUARDED', 'LOW'];
type LevelFilter = 'ALL' | TensionLevel;
type SortKey = 'tension' | 'delta' | 'name';

interface Row {
  zone: ConflictZone;
  score: ZoneScore | undefined;
}

export default function Conflicts() {
  const tension = useSlice('tension');
  const coverage = useCoverageMap();
  const [now, setNow] = useState(() => Date.now());
  const [history, setHistory] = useState<Record<string, HistoryPoint[]>>({});
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('tension');
  const [region, setRegion] = useState<string>('ALL');
  const [selectedZone, setSelectedZone] = useState<string | null>(null);

  // ticking clock for ages / retry countdowns
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // per-zone GDELT coverage driver (shared queue, idempotent)
  useEffect(() => {
    ensureCoverageStarted();
  }, []);

  // cache every engine recompute for sparklines / Δ24h
  useEffect(() => {
    if (Object.keys(tension.data.zones).length > 0) {
      setHistory(appendZoneScores(tension.data.zones));
    }
  }, [tension.data.zones]);

  const regions = useMemo(() => [...new Set(CONFLICT_ZONES.map((z) => z.region))].sort(), []);

  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: CONFLICT_ZONES.length };
    for (const l of LEVELS) counts[l] = 0;
    for (const z of CONFLICT_ZONES) {
      const s = tension.data.zones[z.id];
      if (s) counts[s.level]++;
    }
    return counts;
  }, [tension.data.zones]);

  const rows = useMemo<Row[]>(() => {
    let out: Row[] = CONFLICT_ZONES.map((zone) => ({ zone, score: tension.data.zones[zone.id] }));
    if (levelFilter !== 'ALL') out = out.filter((r) => r.score?.level === levelFilter);
    if (region !== 'ALL') out = out.filter((r) => r.zone.region === region);
    const histOf = (id: string) => history[id] ?? [];
    out = [...out].sort((a, b) => {
      if (sortKey === 'name') return a.zone.name.localeCompare(b.zone.name);
      if (sortKey === 'delta') {
        const da = a.score ? zoneDelta(histOf(a.zone.id), a.score).value : -Infinity;
        const db = b.score ? zoneDelta(histOf(b.zone.id), b.score).value : -Infinity;
        return db - da;
      }
      return (b.score?.score ?? -1) - (a.score?.score ?? -1);
    });
    return out;
  }, [tension.data.zones, levelFilter, region, sortKey, history]);

  const engineWarming = Object.keys(tension.data.zones).length === 0;
  const selected = selectedZone ? CONFLICT_ZONES.find((z) => z.id === selectedZone) : undefined;

  return (
    <div className="mx-auto max-w-[1440px] px-6 pb-16">
      <PageHeader tension={tension} />

      <div className="mt-16">
        <MethodologyBanner />
      </div>

      {/* ---------------- watchlist ---------------- */}
      <section className="mt-16">
        {/* filter row */}
        <div className="flex flex-wrap items-center gap-2">
          {(['ALL', ...LEVELS] as LevelFilter[]).map((l) => {
            const active = levelFilter === l;
            const color = l === 'ALL' ? 'var(--ink)' : LEVEL_COLORS[l];
            return (
              <button
                key={l}
                type="button"
                onClick={() => setLevelFilter(l)}
                className={`border px-2.5 py-1 font-data text-[10px] uppercase tracking-[0.08em] transition-colors duration-150 ${
                  active ? 'border-wf-line-hi bg-bg-3' : 'border-wf-line hover:border-wf-line-hi'
                }`}
                style={{ color: active ? color : 'var(--ink-dim)' }}
              >
                {l}
                <span className="ml-1.5 tabular-nums text-wf-ink-faint">{levelCounts[l] ?? 0}</span>
              </button>
            );
          })}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* sort toggle */}
            <div className="flex border border-wf-line">
              {(
                [
                  ['tension', 'TENSION'],
                  ['delta', 'Δ24H'],
                  ['name', 'NAME'],
                ] as Array<[SortKey, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSortKey(key)}
                  className={`px-2.5 py-1 font-data text-[10px] uppercase tracking-[0.08em] transition-colors duration-150 ${
                    sortKey === key ? 'bg-bg-3 text-wf-cyan' : 'text-wf-ink-dim hover:text-wf-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {/* region dropdown */}
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="border border-wf-line bg-bg-1 px-2 py-1 font-data text-[10px] uppercase tracking-[0.08em] text-wf-ink-dim focus:border-wf-line-hi focus:outline-none"
              aria-label="Filter by region"
            >
              <option value="ALL">ALL REGIONS</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* engine warm-up banner (honest loading state) */}
        {engineWarming && (
          <HudFrame className="mt-4 p-4">
            <div className="flex flex-wrap items-center gap-3 font-data text-[11px] uppercase tracking-[0.08em] text-wf-ink-dim">
              <span className="inline-block h-2 w-2 rounded-full bg-wf-amber wf-anim-blink" />
              {tension.status === 'error'
                ? `Tension engine error — ${tension.error ?? 'GDELT unreachable'}. Retrying on the 15-min cycle.`
                : `Scoring ${CONFLICT_ZONES.length} zones via GDELT — first pass takes ~2 min through the 6s request queue…`}
              <span className="tabular-nums text-wf-ink-faint">
                {tension.data.scored}/{tension.data.total || CONFLICT_ZONES.length}
              </span>
            </div>
          </HudFrame>
        )}

        {/* card grid */}
        {rows.length === 0 && !engineWarming ? (
          <HudFrame className="mt-4 p-4 font-data text-[11px] uppercase tracking-[0.08em] text-wf-ink-faint">
            No zones match this filter combination.
          </HudFrame>
        ) : (
          <motion.div
            className="mt-4 grid grid-cols-1 gap-2 min-[720px]:grid-cols-2 min-[1100px]:grid-cols-3"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.05 }}
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}
          >
            {rows.map(({ zone, score }, i) => (
              <ZoneCard
                key={zone.id}
                zone={zone}
                rank={i + 1}
                score={score}
                coverage={coverage[zone.id] ?? { status: 'idle', articles: [], lastFetch: null, lastAttempt: null, error: null }}
                history={history[zone.id] ?? []}
                tension={tension}
                now={now}
                onOpen={setSelectedZone}
              />
            ))}
          </motion.div>
        )}

        <p className="mt-4 font-body text-[12px] leading-4 text-wf-ink-faint">
          Derived instability indicator — not a forecast of certainty. Sorted live; cards re-rank as the
          engine recomputes every 15 minutes.
        </p>
      </section>

      {/* ---------------- escalations ---------------- */}
      <section className="mt-16">
        <EscalationsStrip tension={tension.data} />
      </section>

      {/* ---------------- freshness ---------------- */}
      <FreshnessBand now={now} />

      {/* ---------------- detail modal ---------------- */}
      <AnimatePresence>
        {selected && (
          <ZoneDetailModal
            key={selected.id}
            zone={selected}
            score={tension.data.zones[selected.id]}
            onClose={() => setSelectedZone(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
