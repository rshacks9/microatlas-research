/**
 * EntityDrawer — right slide-over (320px) on entity click.
 * Live mono telemetry (sats propagate at 1Hz locally), TRACK toggle
 * (camera follow), COPY JSON, external source link, provenance line.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import HudFrame from '@/components/HudFrame';
import { useLiveState, ageLabel } from '@/store/useLiveStore';
import type { SelectedEntity } from '@/components/CesiumGlobe';
import { buildSatRecs, propagate, orbitalPeriodMin, inclinationDeg } from '@/lib/sattrack';
import { CONFLICT_ZONES } from '@/lib/zones';
import { LEVEL_COLORS } from '@/lib/tension';
import { CADENCE } from '@/lib/sources';

const KIND_COLOR: Record<SelectedEntity['kind'], string> = {
  satellite: '#2EE6C8',
  aircraft: '#FFB020',
  ship: '#4EA8FF',
  zone: '#FF3B47',
  news: '#D7E6EF',
  event: '#9B8CFF',
};

function Row({ label, value, flash }: { label: string; value: string; flash?: boolean }) {
  return (
    <div className="flex items-baseline justify-between border-b border-wf-line/40 py-1.5">
      <span className="font-data text-[10px] uppercase tracking-[0.08em] text-wf-ink-faint">{label}</span>
      <span className={`font-data text-[13px] tabular-nums ${flash ? 'text-wf-cyan' : 'text-wf-ink'}`}>{value}</span>
    </div>
  );
}

function SatelliteBody({ norad, tick }: { norad: number; tick: number }) {
  const tle = useLiveState().tle;
  const entry = useMemo(() => buildSatRecs(tle.data.filter((s) => s.norad === norad))[0], [tle.data, norad]);
  void tick;
  if (!entry) return <div className="py-3 font-data text-[11px] text-wf-ink-faint">OBJECT NOT IN CURRENT TLE SET</div>;
  const pos = propagate(entry.satrec, new Date());
  const period = orbitalPeriodMin(entry.satrec);
  const epochAge = entry.tle.epochMs ? (Date.now() - entry.tle.epochMs) / 86_400_000 : null;
  return (
    <>
      <Row label="Name" value={entry.tle.name} />
      <Row label="NORAD" value={String(entry.tle.norad)} />
      <Row label="Lat" value={pos ? `${pos.lat.toFixed(4)}°` : '—'} />
      <Row label="Lon" value={pos ? `${pos.lon.toFixed(4)}°` : '—'} />
      <Row label="Alt km" value={pos ? pos.altKm.toFixed(1) : '—'} />
      <Row label="Vel km·s⁻¹" value={pos ? pos.velKmS.toFixed(2) : '—'} />
      <Row label="Incl" value={`${inclinationDeg(entry.satrec).toFixed(2)}°`} />
      <Row label="Period" value={period ? `${period.toFixed(1)} min` : '—'} />
      <Row label="TLE epoch age" value={epochAge != null ? `${epochAge.toFixed(1)} d` : '—'} />
      <Row label="Group" value={entry.tle.group.toUpperCase()} />
    </>
  );
}

export default function EntityDrawer({
  selected,
  onClose,
  tracking,
  onToggleTrack,
}: {
  selected: SelectedEntity | null;
  onClose: () => void;
  tracking: boolean;
  onToggleTrack: () => void;
}) {
  const state = useLiveState();
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => {
      setTick((n) => n + 1);
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  let title = '';
  let body: React.ReactNode = null;
  let sourceLine = '';
  let sourceUrl: string | null = null;
  let canTrack = false;

  if (selected?.kind === 'satellite') {
    const sat = state.tle.data.find((s) => s.norad === selected.id);
    title = sat?.name ?? `NORAD ${selected.id}`;
    body = <SatelliteBody norad={selected.id} tick={tick} />;
    sourceLine = `SOURCE: CELESTRAK · UPDATED ${ageLabel(state.tle.lastFetch, now)} AGO`;
    sourceUrl = 'https://celestrak.org';
    canTrack = true;
  } else if (selected?.kind === 'aircraft') {
    const ac = state.aircraft.data.find((a) => a.hex === selected.id);
    title = ac?.flight || selected.id.toUpperCase();
    body = ac ? (
      <>
        <Row label="Callsign" value={ac.flight || '—'} />
        <Row label="ICAO24" value={ac.hex.toUpperCase()} />
        <Row label="Alt ft" value={ac.altBaro != null ? ac.altBaro.toLocaleString() : '—'} />
        <Row label="GS kt" value={ac.gs != null ? ac.gs.toFixed(0) : '—'} />
        <Row label="Track°" value={ac.track != null ? ac.track.toFixed(0) : '—'} />
        <Row label="Squawk" value={ac.squawk ?? '—'} />
        <Row label="Type" value={ac.type ?? '—'} />
        <Row label="Seen" value={ac.seenSec != null ? `${ac.seenSec.toFixed(0)}s ago` : '—'} />
      </>
    ) : (
      <div className="py-3 font-data text-[11px] text-wf-ink-faint">TRACK LOST — WAITING FOR NEXT ADS-B POLL</div>
    );
    sourceLine = `SOURCE: ADSB.LOL · UPDATED ${ageLabel(state.aircraft.lastFetch, now)} AGO`;
    sourceUrl = 'https://adsb.lol';
    canTrack = true;
  } else if (selected?.kind === 'ship') {
    const sh = state.ships.data.find((s) => s.mmsi === selected.id);
    title = sh?.name || `MMSI ${selected.id}`;
    body = sh ? (
      <>
        <Row label="MMSI" value={String(sh.mmsi)} />
        <Row label="SOG kt" value={sh.sog != null ? sh.sog.toFixed(1) : '—'} />
        <Row label="COG°" value={sh.cog != null ? sh.cog.toFixed(0) : '—'} />
        <Row label="Heading°" value={sh.heading != null ? String(sh.heading) : '—'} />
        <Row label="Last AIS" value={sh.timestampMs ? ageLabel(sh.timestampMs, now) + ' ago' : '—'} />
        <Row label="Coverage" value="BALTIC / FINLAND" />
      </>
    ) : (
      <div className="py-3 font-data text-[11px] text-wf-ink-faint">VESSEL NOT IN LATEST AIS FRAME</div>
    );
    sourceLine = `SOURCE: DIGITRAFFIC AIS · UPDATED ${ageLabel(state.ships.lastFetch, now)} AGO`;
    sourceUrl = 'https://meri.digitraffic.fi';
  } else if (selected?.kind === 'zone') {
    const zone = CONFLICT_ZONES.find((z) => z.id === selected.id);
    const score = state.tension.data.zones[selected.id];
    title = zone?.name ?? selected.id;
    const color = score ? LEVEL_COLORS[score.level] : 'var(--ink-faint)';
    body = (
      <>
        <Row label="Tension" value={score ? score.score.toFixed(1) : '—'} />
        <Row label="Level" value={score?.level ?? 'SYNCING'} flash={!!score} />
        <Row label="Δ vs prev" value={score ? `${score.delta > 0 ? '+' : ''}${score.delta.toFixed(1)}` : '—'} />
        <Row label="Vol z-score" value={score ? score.zVol.toFixed(2) : '—'} />
        <Row label="Tone Δ" value={score ? score.toneDelta.toFixed(2) : '—'} />
        <div className="mt-2 font-body text-[10px] leading-4 text-wf-ink-faint">
          Derived instability indicator from GDELT real-time signals — not a forecast of certainty.
        </div>
        <Link to="/conflicts" className="mt-2 inline-block font-data text-[11px] uppercase" style={{ color }}>
          Open monitor →
        </Link>
      </>
    );
    sourceLine = `SOURCE: GDELT TIMELINE · ${CADENCE.tension / 60000}MIN CADENCE`;
    sourceUrl = 'https://www.gdeltproject.org';
  } else if (selected?.kind === 'event') {
    const ev = [...state.eonet.data, ...state.usgs.data].find((x) => x.id === selected.id);
    title = ev?.title ?? 'EVENT';
    body = ev ? (
      <>
        <Row label="Type" value={ev.category} />
        <Row label="Magnitude" value={ev.magnitude != null ? ev.magnitude.toFixed(1) : '—'} />
        <Row label="Time" value={ev.timeMs ? ageLabel(ev.timeMs, now) + ' ago' : '—'} />
        <Row label="Lat" value={`${ev.lat.toFixed(2)}°`} />
        <Row label="Lon" value={`${ev.lon.toFixed(2)}°`} />
      </>
    ) : (
      <div className="py-3 font-data text-[11px] text-wf-ink-faint">EVENT EXPIRED FROM FEED</div>
    );
    sourceLine = `SOURCE: ${ev?.kind === 'usgs' ? 'USGS' : 'NASA EONET'} · UPDATED ${ageLabel(ev?.kind === 'usgs' ? state.usgs.lastFetch : state.eonet.lastFetch, now)} AGO`;
    sourceUrl = ev?.url ?? null;
  } else if (selected?.kind === 'news') {
    const n = state.news.data.find((x) => x.url === selected.id);
    title = n?.title ?? 'NEWS MARKER';
    body = n ? (
      <>
        <Row label="Source" value={n.domain} />
        <Row label="Country" value={n.sourceCountry} />
        <Row label="Seen" value={n.seenDate} />
        <Row label="Geolocation" value={n.approx ? 'APPROX (CENTROID)' : '—'} />
      </>
    ) : null;
    sourceLine = `SOURCE: GDELT DOC 2.0 · UPDATED ${ageLabel(state.news.lastFetch, now)} AGO`;
    sourceUrl = selected.id;
  }

  return (
    <AnimatePresence>
      {selected && (
        <motion.div
          initial={{ x: 320 }}
          animate={{ x: 0 }}
          exit={{ x: 320 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-auto absolute bottom-12 right-3 top-16 z-40 w-80"
        >
          <HudFrame active={tracking} className="flex h-full flex-col">
            {/* header */}
            <div
              className="flex h-10 shrink-0 items-center gap-2 border-b border-wf-line px-3"
              style={{ borderColor: tracking ? '#FFB02088' : undefined }}
            >
              <span
                className="px-1.5 py-0.5 font-data text-[10px] uppercase tracking-[0.08em]"
                style={{ color: KIND_COLOR[selected.kind], border: `1px solid ${KIND_COLOR[selected.kind]}55` }}
              >
                {selected.kind}
              </span>
              <span className="truncate font-display text-sm font-semibold text-wf-ink">{title}</span>
              <span className="flex-1" />
              <button onClick={onClose} className="text-wf-ink-dim hover:text-wf-ink" aria-label="Close">
                <X size={14} />
              </button>
            </div>

            {/* telemetry */}
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">{body}</div>

            {/* footer actions */}
            <div className="shrink-0 border-t border-wf-line px-3 py-2.5">
              <div className="flex gap-2">
                {canTrack && (
                  <button
                    onClick={onToggleTrack}
                    className={`border px-2.5 py-1 font-data text-[10px] uppercase tracking-[0.08em] ${
                      tracking ? 'border-wf-amber text-wf-amber' : 'border-wf-line text-wf-ink-dim hover:border-wf-line-hi'
                    }`}
                  >
                    {tracking ? '■ Tracking' : 'Track'}
                  </button>
                )}
                <button
                  onClick={() => {
                    const payload = { selected, at: new Date().toISOString() };
                    void navigator.clipboard?.writeText(JSON.stringify(payload, null, 2)).catch(() => undefined);
                  }}
                  className="border border-wf-line px-2.5 py-1 font-data text-[10px] uppercase tracking-[0.08em] text-wf-ink-dim hover:border-wf-line-hi"
                >
                  Copy JSON
                </button>
                {sourceUrl && (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="border border-wf-line px-2.5 py-1 font-data text-[10px] uppercase tracking-[0.08em] text-wf-cyan hover:border-wf-line-hi"
                  >
                    Source ↗
                  </a>
                )}
              </div>
              <div className="mt-2 font-data text-[10px] text-wf-ink-faint">{sourceLine}</div>
            </div>
          </HudFrame>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
