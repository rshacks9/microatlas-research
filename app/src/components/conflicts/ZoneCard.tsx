/**
 * ZoneCard — one flashpoint in the watchlist grid (conflicts.md §3).
 * Every number is live: score/zVol/toneDelta from the tension engine,
 * headline + article count from the zone's real GDELT artlist query.
 * States: unscored (SYNC), engine error (SIGNAL STALE + retry countdown),
 * zero-coverage (NO COVERAGE IN WINDOW), live.
 */

import { memo, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import HudFrame from '@/components/HudFrame';
import { LEVEL_COLORS } from '@/lib/tension';
import type { ZoneScore } from '@/lib/tension';
import type { ConflictZone } from '@/lib/zones';
import { ageLabel, derivedStatus } from '@/store/useLiveStore';
import type { Slice, TensionData } from '@/store/useLiveStore';
import Sparkline from './Sparkline';
import type { HistoryPoint } from './zoneHistory';
import { zoneDelta } from './zoneHistory';
import type { ZoneCoverage } from './coverageStore';

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } },
};

function DeltaTag({ score, history }: { score: ZoneScore; history: HistoryPoint[] }) {
  const d = zoneDelta(history, score);
  const up = d.value > 0;
  const flat = d.value === 0;
  const color = flat ? 'var(--ink-faint)' : up ? '#FF3B47' : '#3DF58A';
  return (
    <span className="font-data text-[11px] tabular-nums" style={{ color }} title={d.kind === '24h' ? 'Change vs 24h ago (cached history)' : 'Change vs previous engine computation'}>
      {flat ? '—' : up ? '▲' : '▼'}
      {!flat && Math.abs(d.value).toFixed(1)}
      <span className="ml-1 text-[9px] uppercase tracking-[0.08em] text-wf-ink-faint">
        {d.kind === '24h' ? 'Δ 24H' : 'Δ RE-SCORE'}
      </span>
    </span>
  );
}

function SignalCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="font-display text-[9px] font-medium uppercase tracking-[0.14em] text-wf-ink-faint">{label}</div>
      <div className="mt-0.5 font-data text-[12px] tabular-nums" style={{ color: color ?? 'var(--ink-dim)' }}>
        {value}
      </div>
    </div>
  );
}

function Headline({ coverage }: { coverage: ZoneCoverage }) {
  if (coverage.status === 'idle' || coverage.status === 'loading') {
    return <p className="font-data text-[10px] uppercase tracking-[0.08em] text-wf-ink-faint">Fetching coverage — GDELT queue…</p>;
  }
  if (coverage.status === 'error' && coverage.articles.length === 0) {
    return (
      <p className="font-data text-[10px] uppercase tracking-[0.08em] text-wf-amber">
        Coverage unavailable — {coverage.error ?? 'GDELT error'}
      </p>
    );
  }
  const a = coverage.articles[0];
  if (!a) {
    return <p className="font-data text-[10px] uppercase tracking-[0.08em] text-wf-ink-faint">No coverage in window (24h)</p>;
  }
  return (
    <div>
      <a
        href={a.url}
        target="_blank"
        rel="noreferrer"
        className="line-clamp-2 font-body text-[12px] leading-4 text-wf-ink-dim transition-colors hover:text-wf-ink"
        onClick={(e) => e.stopPropagation()}
      >
        {a.title}
      </a>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {a.sourceCountry && (
          <span className="border border-wf-line px-1 py-px font-data text-[9px] uppercase tracking-[0.08em] text-wf-ink-faint">
            {a.sourceCountry}
          </span>
        )}
        <span className="border border-wf-line px-1 py-px font-data text-[9px] uppercase tracking-[0.08em] text-wf-ink-faint">
          Approx geo
        </span>
        <span className="font-data text-[9px] text-wf-ink-faint">{a.domain}</span>
      </div>
    </div>
  );
}

function ZoneCardInner({
  zone,
  rank,
  score,
  coverage,
  history,
  tension,
  now,
  onOpen,
}: {
  zone: ConflictZone;
  rank: number;
  score: ZoneScore | undefined;
  coverage: ZoneCoverage;
  history: HistoryPoint[];
  tension: Slice<TensionData>;
  now: number;
  onOpen: (zoneId: string) => void;
}) {
  const engineStatus = derivedStatus(tension, now);
  const levelColor = score ? LEVEL_COLORS[score.level] : 'var(--ink-faint)';

  // flash on live recompute
  const [flash, setFlash] = useState(false);
  const prevScore = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (score && prevScore.current !== undefined && prevScore.current !== score.score) {
      setFlash(true);
      const t = window.setTimeout(() => setFlash(false), 800);
      return () => window.clearTimeout(t);
    }
    prevScore.current = score?.score;
    return undefined;
  }, [score]);

  const retryIn = tension.lastAttempt ? Math.max(0, Math.ceil((tension.lastAttempt + tension.pollMs - now) / 1000)) : null;
  const retryLabel = retryIn != null ? (retryIn >= 60 ? `${Math.floor(retryIn / 60)}m${String(retryIn % 60).padStart(2, '0')}s` : `${retryIn}s`) : '—';

  return (
    <motion.div layout="position" variants={cardVariants} whileHover={{ y: -2 }} transition={{ duration: 0.15 }}>
      <HudFrame
        className={`group flex h-full cursor-pointer flex-col p-4 transition-[border-color,box-shadow,background-color] duration-150 hover:border-wf-line-hi hover:shadow-[inset_0_0_0_1px_var(--line-hi)] ${
          flash ? 'bg-bg-3' : ''
        } ${engineStatus === 'error' ? 'opacity-80' : ''}`}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => onOpen(zone.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onOpen(zone.id);
          }}
          className="flex h-full flex-col text-left focus:outline-none"
        >
          {/* top row: rank + alert chip */}
          <div className="flex items-center justify-between">
            <span className="font-data text-[11px] text-wf-ink-faint">#{String(rank).padStart(2, '0')}</span>
            {engineStatus === 'error' ? (
              <span className="border border-wf-amber/40 px-1.5 py-0.5 font-data text-[9px] uppercase tracking-[0.08em] text-wf-amber">
                Signal stale · retrying {retryLabel}
              </span>
            ) : score ? (
              <span
                className="border px-1.5 py-0.5 font-data text-[9px] uppercase tracking-[0.08em]"
                style={{ color: levelColor, borderColor: `color-mix(in srgb, ${levelColor} 40%, transparent)` }}
              >
                {score.level}
              </span>
            ) : (
              <span className="border border-wf-line px-1.5 py-0.5 font-data text-[9px] uppercase tracking-[0.08em] text-wf-ink-faint">
                Awaiting score
              </span>
            )}
          </div>

          {/* name + region */}
          <div className="mt-2 font-display text-[20px] font-semibold leading-[26px] tracking-[0.08em] text-wf-ink">
            {zone.name}
          </div>
          <div className="font-display text-[11px] font-medium uppercase tracking-[0.14em] text-wf-ink-dim">
            {zone.region}
          </div>

          {/* score + delta */}
          <div className="mt-3 flex items-end justify-between gap-2">
            <span className="font-data text-[24px] font-bold leading-7 tabular-nums" style={{ color: levelColor }}>
              {score ? score.score.toFixed(1) : '—.—'}
            </span>
            {score && <DeltaTag score={score} history={history} />}
          </div>

          {/* sparkline */}
          <div className="mt-2">
            <Sparkline history={history} current={score?.score ?? null} color={score ? levelColor : '#3A4B59'} />
          </div>

          {/* signal rows */}
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
            <SignalCell label="News vol 24h" value={score ? String(Math.round(score.latestVol)) : '—'} />
            <SignalCell
              label="Vol z-score"
              value={score ? `${score.zVol >= 0 ? '+' : ''}${score.zVol.toFixed(2)}` : '—'}
              color={score && score.zVol > 2 ? '#FF7A45' : undefined}
            />
            <SignalCell
              label="Tone Δ"
              value={score ? `${score.toneDelta >= 0 ? '+' : ''}${score.toneDelta.toFixed(2)}` : '—'}
              color={score && score.toneDelta > 1.5 ? '#FF7A45' : undefined}
            />
            <SignalCell
              label="Articles"
              value={
                coverage.status === 'live'
                  ? String(coverage.articles.length)
                  : coverage.status === 'error'
                    ? 'ERR'
                    : '…'
              }
            />
          </div>

          {/* latest headline */}
          <div className="mt-3 min-h-[52px] border-t border-wf-line pt-2">
            <Headline coverage={coverage} />
          </div>

          {/* footer */}
          <div className="mt-auto flex items-center justify-between pt-3">
            <span className="font-data text-[9px] uppercase tracking-[0.08em] text-wf-ink-faint">
              Source: GDELT · {ageLabel(tension.lastFetch, now)}
            </span>
            <span className="font-data text-[10px] uppercase tracking-[0.08em] text-wf-cyan opacity-70 transition-opacity group-hover:opacity-100">
              Open →
            </span>
          </div>
        </div>
      </HudFrame>
    </motion.div>
  );
}

const ZoneCard = memo(ZoneCardInner);
export default ZoneCard;
