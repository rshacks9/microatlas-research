/**
 * ZoneDetailModal — deep-dive on one flashpoint (conflicts.md §4).
 * Left: dual-series timeline chart drawn from REAL GDELT fetches
 * (timelinevol 7d + timelinetone 7d for the zone query, via the shared
 * 6s queue / 15-min cache). Right: up to 15 real GDELT articles.
 * Footer: engine internals + disclaimer. No fabricated numbers anywhere.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import HudFrame from '@/components/HudFrame';
import { gdeltDocUrl, gdeltFetch } from '@/lib/sources';
import type { GdeltArtlistResponse, GdeltTimelineResponse } from '@/lib/sources';
import { LEVEL_COLORS, zoneTimelineGroup } from '@/lib/tension';
import type { ZoneScore } from '@/lib/tension';
import type { ConflictZone } from '@/lib/zones';
import { formatSeenDate, formatUtc } from './coverageStore';
import type { ZoneArticle } from './coverageStore';

/* ---------------- live fetches (shared GDELT queue) ---------------- */

interface TimelineData {
  days: string[]; // "MM-DD" labels
  vol: number[];
  tone: number[];
}

function parseDayLabel(raw: string): string {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[2]}-${m[3]}` : raw.slice(0, 6);
}

async function fetchZoneTimeline(zone: ConflictZone): Promise<TimelineData> {
  const q = zoneTimelineGroup(zone);
  const [volRes, toneRes] = await Promise.all([
    gdeltFetch<GdeltTimelineResponse>(gdeltDocUrl({ query: q, mode: 'timelinevol', timespan: '7d' })),
    gdeltFetch<GdeltTimelineResponse>(gdeltDocUrl({ query: q, mode: 'timelinetone', timespan: '7d' })),
  ]);
  const volSeries = volRes.timeline?.[0]?.data ?? [];
  const toneSeries = toneRes.timeline?.[0]?.data ?? [];
  if (volSeries.length === 0) throw new Error('GDELT returned no timeline for this zone');
  return {
    days: volSeries.map((d) => parseDayLabel(d.date)),
    vol: volSeries.map((d) => d.value),
    tone: toneSeries.map((d) => d.value),
  };
}

async function fetchZoneArticleList(zone: ConflictZone): Promise<ZoneArticle[]> {
  const url = `${gdeltDocUrl({ query: zone.gdeltQuery, mode: 'artlist', maxrecords: 15, timespan: '24h' })}&sort=hybridrel`;
  const res = await gdeltFetch<GdeltArtlistResponse>(url);
  return (res.articles ?? [])
    .filter((a) => a.title && a.url)
    .map((a) => ({
      title: a.title,
      url: a.url,
      domain: a.domain ?? '',
      sourceCountry: a.sourcecountry ?? '',
      seenDate: a.seendate ?? '',
      tone: typeof (a as { tone?: unknown }).tone === 'number' ? ((a as { tone?: number }).tone ?? null) : null,
    }));
}

/* ---------------- timeline chart (hand-rolled SVG, HUD grade) ---------------- */

const CW = 460;
const CH = 240;
const CPAD = { t: 12, r: 8, b: 22, l: 8 };

function TimelineChart({ data }: { data: TimelineData }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = data.vol.length;
  const innerW = CW - CPAD.l - CPAD.r;
  const innerH = CH - CPAD.t - CPAD.b;
  const maxVol = Math.max(...data.vol, 1);
  const toneAbs = Math.max(...data.tone.map((t) => Math.abs(t)), 1);

  const x = (i: number) => CPAD.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yVol = (v: number) => CPAD.t + innerH - (v / maxVol) * innerH;
  const yTone = (v: number) => CPAD.t + innerH / 2 - (v / toneAbs) * (innerH / 2);

  // baseline band: mean ± 1σ of the window excluding the latest bucket
  const base = data.vol.slice(0, -1);
  const mean = base.length ? base.reduce((a, b) => a + b, 0) / base.length : 0;
  const sd = base.length > 1 ? Math.sqrt(base.reduce((a, x) => a + (x - mean) ** 2, 0) / (base.length - 1)) : 0;
  const bandTop = yVol(Math.min(maxVol, mean + sd));
  const bandBot = yVol(Math.max(0, mean - sd));

  const volLine = data.vol.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yVol(v).toFixed(1)}`).join(' ');
  const volArea = `${volLine} L${x(n - 1).toFixed(1)},${(CPAD.t + innerH).toFixed(1)} L${x(0).toFixed(1)},${(CPAD.t + innerH).toFixed(1)} Z`;
  const toneLine =
    data.tone.length > 1
      ? data.tone.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yTone(v).toFixed(1)}`).join(' ')
      : '';

  return (
    <div>
      <svg
        viewBox={`0 0 ${CW} ${CH}`}
        className="block w-full"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * CW;
          const i = Math.round(((px - CPAD.l) / innerW) * (n - 1));
          setHover(Math.max(0, Math.min(n - 1, i)));
        }}
      >
        {/* baseline band */}
        <rect x={CPAD.l} y={bandTop} width={innerW} height={Math.max(1, bandBot - bandTop)} fill="#2EE6C8" opacity="0.06" />
        <line x1={CPAD.l} y1={yVol(mean)} x2={CPAD.l + innerW} y2={yVol(mean)} stroke="#2EE6C8" strokeWidth="1" strokeDasharray="3 3" opacity="0.35" />
        {/* tone zero line */}
        <line x1={CPAD.l} y1={yTone(0)} x2={CPAD.l + innerW} y2={yTone(0)} stroke="#FF3B47" strokeWidth="1" strokeDasharray="2 4" opacity="0.3" />
        {/* volume area */}
        <path d={volArea} fill="#2EE6C8" opacity="0.12" />
        <motion.path
          d={volLine}
          fill="none"
          stroke="#2EE6C8"
          strokeWidth="1.5"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
        {/* tone line */}
        {toneLine && (
          <motion.path
            d={toneLine}
            fill="none"
            stroke="#FF3B47"
            strokeWidth="1.5"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.8, delay: 0.2, ease: 'easeOut' }}
          />
        )}
        {/* hover crosshair */}
        {hover != null && (
          <g>
            <line x1={x(hover)} y1={CPAD.t} x2={x(hover)} y2={CPAD.t + innerH} stroke="var(--ink-faint)" strokeWidth="1" />
            <circle cx={x(hover)} cy={yVol(data.vol[hover])} r="3" fill="#2EE6C8" />
            {data.tone[hover] != null && <circle cx={x(hover)} cy={yTone(data.tone[hover])} r="3" fill="#FF3B47" />}
          </g>
        )}
        {/* day labels */}
        {data.days.map((d, i) => (
          <text key={i} x={x(i)} y={CH - 6} textAnchor="middle" fill="var(--ink-faint)" fontSize="9" fontFamily="JetBrains Mono, monospace">
            {d}
          </text>
        ))}
      </svg>
      <div className="mt-1 flex items-center justify-between font-data text-[10px] text-wf-ink-faint">
        <span>
          <span className="text-wf-cyan">■</span> ARTICLE VOLUME / DAY · <span className="text-wf-red">■</span> AVG TONE / DAY (0-CENTERED, NEGATIVE = DARKER)
        </span>
        {hover != null && (
          <span className="tabular-nums text-wf-ink-dim">
            {data.days[hover]} · VOL {Math.round(data.vol[hover])} · TONE {data.tone[hover] != null ? data.tone[hover].toFixed(2) : '—'}
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------------- article list ---------------- */

function ArticleList({ zone }: { zone: ConflictZone }) {
  const [articles, setArticles] = useState<ZoneArticle[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchZoneArticleList(zone)
      .then((a) => alive && setArticles(a))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'GDELT fetch failed'));
    return () => {
      alive = false;
    };
  }, [zone]);

  if (error && !articles) {
    return <p className="p-3 font-data text-[10px] uppercase tracking-[0.08em] text-wf-amber">Coverage unavailable — {error}</p>;
  }
  if (!articles) {
    return <p className="p-3 font-data text-[10px] uppercase tracking-[0.08em] text-wf-ink-faint">Fetching latest coverage — GDELT queue…</p>;
  }
  if (articles.length === 0) {
    return <p className="p-3 font-data text-[10px] uppercase tracking-[0.08em] text-wf-ink-faint">No coverage in window (24h)</p>;
  }
  return (
    <ul className="max-h-[46vh] overflow-y-auto">
      {articles.map((a, i) => (
        <motion.li
          key={a.url}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: Math.min(i * 0.04, 0.6), ease: 'easeOut' }}
          className="border-b border-wf-line last:border-0"
        >
          <a href={a.url} target="_blank" rel="noreferrer" className="group block px-3 py-2.5 transition-colors hover:bg-bg-3">
            <div className="line-clamp-2 font-body text-[13px] leading-5 text-wf-ink group-hover:text-wf-cyan">{a.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-data text-[10px] text-wf-ink-faint">
              <span>{a.domain}</span>
              {a.sourceCountry && <span className="uppercase">· {a.sourceCountry}</span>}
              <span>· {formatSeenDate(a.seenDate)}</span>
              {a.tone != null && (
                <span
                  className="border px-1 font-data text-[9px] tabular-nums"
                  style={{
                    color: a.tone < -2 ? '#FF3B47' : a.tone > 2 ? '#3DF58A' : 'var(--ink-dim)',
                    borderColor: 'var(--line)',
                  }}
                >
                  TONE {a.tone >= 0 ? '+' : ''}
                  {a.tone.toFixed(1)}
                </span>
              )}
            </div>
          </a>
        </motion.li>
      ))}
    </ul>
  );
}

/* ---------------- modal shell ---------------- */

export default function ZoneDetailModal({
  zone,
  score,
  onClose,
}: {
  zone: ConflictZone;
  score: ZoneScore | undefined;
  onClose: () => void;
}) {
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchZoneTimeline(zone)
      .then((t) => alive && setTimeline(t))
      .catch((e) => alive && setTimelineError(e instanceof Error ? e.message : 'GDELT fetch failed'));
    return () => {
      alive = false;
    };
  }, [zone]);

  // ESC close + scroll lock (Lenis scrolls the window; locking <html> freezes it)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = prev;
    };
  }, [onClose]);

  const levelColor = score ? LEVEL_COLORS[score.level] : 'var(--ink-faint)';

  return (
    <>
      <motion.div
        key="scrim"
        className="fixed inset-0 z-[100] bg-black/60"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        onClick={onClose}
      />
      <div className="pointer-events-none fixed inset-0 z-[101] flex items-center justify-center p-4">
        <motion.div
          key="panel"
          className="pointer-events-auto max-h-[85vh] w-full max-w-[960px] overflow-y-auto"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          role="dialog"
          aria-modal="true"
          aria-label={`${zone.name} detail`}
        >
          <HudFrame active className="p-5">
            {/* header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  {score ? (
                    <span
                      className="border px-1.5 py-0.5 font-data text-[10px] uppercase tracking-[0.08em]"
                      style={{ color: levelColor, borderColor: `color-mix(in srgb, ${levelColor} 40%, transparent)` }}
                    >
                      {score.level} · {score.score.toFixed(1)}
                    </span>
                  ) : (
                    <span className="border border-wf-line px-1.5 py-0.5 font-data text-[10px] uppercase tracking-[0.08em] text-wf-ink-faint">
                      Awaiting score
                    </span>
                  )}
                  <span className="font-display text-[11px] font-medium uppercase tracking-[0.14em] text-wf-ink-dim">
                    {zone.region}
                  </span>
                </div>
                <h2 className="mt-1.5 font-display text-[28px] font-semibold leading-[34px] tracking-[0.08em] text-wf-ink">
                  {zone.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="border border-wf-line p-1.5 text-wf-ink-dim transition-colors hover:border-wf-line-hi hover:text-wf-ink"
              >
                <X size={16} />
              </button>
            </div>

            {/* body: two columns */}
            <div className="mt-5 grid gap-5 lg:grid-cols-[55%_45%]">
              <div>
                <div className="font-display text-[11px] font-medium uppercase tracking-[0.14em] text-wf-ink-dim">
                  7-Day Signal Timeline · GDELT
                </div>
                <div className="mt-2 border border-wf-line p-2">
                  {timelineError && !timeline ? (
                    <p className="p-3 font-data text-[10px] uppercase tracking-[0.08em] text-wf-amber">
                      Timeline unavailable — {timelineError}
                    </p>
                  ) : !timeline ? (
                    <p className="p-3 font-data text-[10px] uppercase tracking-[0.08em] text-wf-ink-faint">
                      Fetching timeline — GDELT queue…
                    </p>
                  ) : (
                    <TimelineChart data={timeline} />
                  )}
                </div>
              </div>
              <div>
                <div className="font-display text-[11px] font-medium uppercase tracking-[0.14em] text-wf-ink-dim">
                  Latest coverage · 24h
                </div>
                <div className="mt-2 border border-wf-line">
                  <ArticleList zone={zone} />
                </div>
                <p className="mt-1.5 font-data text-[9px] uppercase tracking-[0.08em] text-wf-ink-faint">
                  Geolocation approximate (source-country centroid) when shown on globe
                </p>
              </div>
            </div>

            {/* footer strip: engine internals */}
            <div className="mt-5 border-t border-wf-line pt-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 font-data text-[10px] tabular-nums text-wf-ink-dim">
                <span>
                  Z-VOL <span className="text-wf-ink">{score ? `${score.zVol >= 0 ? '+' : ''}${score.zVol.toFixed(2)}` : '—'}</span>
                </span>
                <span>
                  TONE Δ <span className="text-wf-ink">{score ? `${score.toneDelta >= 0 ? '+' : ''}${score.toneDelta.toFixed(2)}` : '—'}</span>
                </span>
                <span className="text-wf-ink-faint">SCORE = 50 + 8·ZVOL + 4·TONEΔ, CLAMP 0–100</span>
                <span>
                  COMPUTED <span className="text-wf-ink">{score ? formatUtc(score.computedAt) : '—'}</span>
                </span>
                <Link to={`/?zone=${zone.id}`} className="ml-auto text-wf-cyan hover:underline">
                  VIEW ON GLOBE →
                </Link>
              </div>
              <p className="mt-2 font-body text-[11px] leading-4 text-wf-ink-faint">
                Derived instability indicator from GDELT real-time signals — not a forecast of certainty.
              </p>
            </div>
          </HudFrame>
        </motion.div>
      </div>
    </>
  );
}
