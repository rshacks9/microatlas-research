/**
 * Command Deck (/) — full-viewport live globe framed by HUD chrome.
 * No scrolling, no footer, no Lenis — it's an instrument.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import Navbar from '@/components/Navbar';
import CesiumGlobe from '@/components/CesiumGlobe';
import type { SelectedEntity, FlyTarget } from '@/components/CesiumGlobe';
import BootSequence from '@/components/deck/BootSequence';
import LayerDock from '@/components/deck/LayerDock';
import WatchlistRail from '@/components/deck/WatchlistRail';
import EntityDrawer from '@/components/deck/EntityDrawer';
import BottomTicker from '@/components/deck/BottomTicker';
import ProvenanceDrawer from '@/components/deck/ProvenanceDrawer';
import { useLiveState, useLayers, LAYER_COLORS } from '@/store/useLiveStore';
import type { LayerKey } from '@/store/useLiveStore';
import { CONFLICT_ZONES } from '@/lib/zones';
import { buildSatRecs, propagate } from '@/lib/sattrack';

const BOOT_KEY = 'wf-booted-session';

/* 24px crosshair reticle ring following the cursor (mix-blend-difference). */
function ReticleCursor() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia('(pointer: coarse)').matches) return;
    let x = -100;
    let y = -100;
    let tx = -100;
    let ty = -100;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      tx = e.clientX;
      ty = e.clientY;
    };
    const loop = () => {
      x += (tx - x) * 0.18;
      y += (ty - y) * 0.18;
      if (ref.current) ref.current.style.transform = `translate(${x - 12}px, ${y - 12}px)`;
      raf = requestAnimationFrame(loop);
    };
    window.addEventListener('mousemove', onMove);
    raf = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div
      ref={ref}
      className="pointer-events-none fixed left-0 top-0 z-[60] hidden h-6 w-6 rounded-full border border-wf-cyan/40 mix-blend-difference md:block"
    >
      <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-wf-cyan/60" />
    </div>
  );
}

/* SEARCH / FLY-TO combobox (⌘K): satellites by name/NORAD, zones. */
function SearchFlyTo({ onFlyTo }: { onFlyTo: (t: FlyTarget) => void }) {
  const tle = useLiveState().tle;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const zones = CONFLICT_ZONES.filter((z) => !needle || z.name.toLowerCase().includes(needle))
      .slice(0, 4)
      .map((z) => ({ kind: 'zone' as const, label: z.name, sub: 'FLASHPOINT', lat: z.centroid[0], lon: z.centroid[1] }));
    const sats = needle
      ? tle.data
          .filter((s) => s.name.toLowerCase().includes(needle) || String(s.norad).includes(needle))
          .slice(0, 6)
          .map((s) => ({ kind: 'sat' as const, label: s.name, sub: `NORAD ${s.norad}`, lat: null, lon: null, norad: s.norad }))
      : [];
    return [...zones, ...sats];
  }, [q, tle.data]);

  const pick = (r: (typeof results)[number]) => {
    if (r.kind === 'zone' && r.lat != null && r.lon != null) {
      onFlyTo({ lat: r.lat, lon: r.lon, altKm: 1500, ts: Date.now() });
    } else if (r.kind === 'sat' && r.norad != null) {
      const tleRec = tle.data.find((s) => s.norad === r.norad);
      const entry = tleRec ? buildSatRecs([tleRec])[0] : undefined;
      const pos = entry ? propagate(entry.satrec, new Date()) : null;
      if (pos) onFlyTo({ lat: pos.lat, lon: pos.lon, altKm: Math.max(1500, pos.altKm + 2500), ts: Date.now() });
    }
    setOpen(false);
    setQ('');
  };

  return (
    <div className="pointer-events-auto absolute left-1/2 top-16 z-40 w-[380px] -translate-x-1/2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="wf-panel flex h-8 w-full items-center gap-2 px-3 font-data text-[11px] text-wf-ink-faint hover:border-wf-line-hi"
      >
        <span>SEARCH / FLY-TO</span>
        <span className="flex-1" />
        <span className="border border-wf-line px-1 text-[9px]">⌘K</span>
      </button>
      {open && (
        <div className="wf-panel mt-1">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) pick(results[0]);
            }}
            placeholder="SATELLITE NAME / NORAD / ZONE…"
            className="h-9 w-full border-b border-wf-line bg-transparent px-3 font-data text-[11px] text-wf-ink placeholder:text-wf-ink-faint focus:outline-none"
          />
          <div className="max-h-64 overflow-y-auto">
            {results.length === 0 && (
              <div className="px-3 py-2 font-data text-[10px] text-wf-ink-faint">
                {tle.status === 'live' ? 'NO MATCHES' : 'TLE CATALOG LOADING…'}
              </div>
            )}
            {results.map((r, i) => (
              <button
                key={`${r.label}-${i}`}
                onClick={() => pick(r)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-3"
              >
                <span className="truncate font-data text-[11px] text-wf-ink">{r.label}</span>
                <span className="flex-1" />
                <span className="font-data text-[9px] uppercase text-wf-ink-faint">{r.sub}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* bottom-right layer legend chips */
function LayerLegend() {
  const state = useLiveState();
  const layers = useLayers();
  const chips: Array<{ key: LayerKey; count: number | null }> = [
    { key: 'satellites', count: state.tle.records },
    { key: 'aircraft', count: state.aircraft.records },
    { key: 'ships', count: state.ships.records },
    { key: 'conflictZones', count: 24 },
    { key: 'newsMarkers', count: state.news.records },
    { key: 'naturalEvents', count: state.eonet.records + state.usgs.records },
  ];
  return (
    <div className="pointer-events-none absolute bottom-10 right-3 z-10 flex flex-col items-end gap-1">
      {chips
        .filter((c) => layers[c.key])
        .map((c) => (
          <div key={c.key} className="flex items-center gap-1.5 font-data text-[10px] uppercase text-wf-ink-faint">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: LAYER_COLORS[c.key] }} />
            <span>{c.key.replace(/([A-Z])/g, ' $1')}</span>
            <span className="tabular-nums text-wf-ink-dim">{c.count != null ? c.count.toLocaleString() : ''}</span>
          </div>
        ))}
      <div className="font-data text-[9px] text-wf-ink-faint">AIS COVERAGE: BALTIC/FINLAND (LIVE)</div>
    </div>
  );
}

export default function Home() {
  const [booted, setBooted] = useState(() => sessionStorage.getItem(BOOT_KEY) === '1');
  const [selected, setSelected] = useState<SelectedEntity | null>(null);
  const [tracking, setTracking] = useState(false);
  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null);
  const [provenanceOpen, setProvenanceOpen] = useState(false);

  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  useEffect(() => {
    if (reducedMotion) setBooted(true);
  }, [reducedMotion]);

  const onBootDone = useCallback(() => {
    sessionStorage.setItem(BOOT_KEY, '1');
    setBooted(true);
  }, []);

  const onFlyToZone = useCallback((zoneId: string) => {
    const z = CONFLICT_ZONES.find((c) => c.id === zoneId);
    if (!z) return;
    setFlyTarget({ lat: z.centroid[0], lon: z.centroid[1], altKm: Math.max(1200, z.radiusKm * 3), ts: Date.now() });
    setSelected({ kind: 'zone', id: zoneId });
  }, []);

  const onSelect = useCallback((sel: SelectedEntity | null) => {
    setSelected(sel);
    if (!sel) setTracking(false);
  }, []);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-bg-0">
      <Navbar />

      {/* globe area */}
      <div className="relative min-h-0 flex-1">
        <CesiumGlobe onSelect={onSelect} flyTarget={flyTarget} booted={booted} tracking={tracking} />

        {booted && (
          <>
            <SearchFlyTo onFlyTo={setFlyTarget} />
            <LayerDock onOpenProvenance={() => setProvenanceOpen(true)} />
            <WatchlistRail onFlyToZone={onFlyToZone} />
            <LayerLegend />
            <EntityDrawer
              selected={selected}
              onClose={() => onSelect(null)}
              tracking={tracking}
              onToggleTrack={() => setTracking((t) => !t)}
            />
            <ProvenanceDrawer open={provenanceOpen} onClose={() => setProvenanceOpen(false)} />
          </>
        )}
      </div>

      <BottomTicker />

      <ReticleCursor />

      <AnimatePresence>{!booted && <BootSequence onDone={onBootDone} />}</AnimatePresence>
    </div>
  );
}
