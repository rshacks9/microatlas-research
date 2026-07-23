/**
 * TopBar (48px, all pages) — logomark + wordmark, page nav,
 * GLOBAL TENSION chip, ticking UTC clock, per-source status dots.
 * Positioning contract: sticky top-0 z-50 (in normal document flow).
 */

import { useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { useLiveState, ageLabel } from '@/store/useLiveStore';
import type { SourceKey } from '@/store/useLiveStore';
import { levelFor, LEVEL_COLORS } from '@/lib/tension';

const LINKS = [
  { to: '/', label: 'DECK' },
  { to: '/conflicts', label: 'CONFLICTS' },
  { to: '/tracking', label: 'TRACKING' },
  { to: '/signals', label: 'SIGNALS' },
  { to: '/intel', label: 'INTEL' },
  { to: '/sources', label: 'SOURCES' },
];

const SOURCE_DOTS: Array<{ key: SourceKey; name: string }> = [
  { key: 'tle', name: 'CelesTrak TLE' },
  { key: 'aircraft', name: 'adsb.lol ADS-B' },
  { key: 'ships', name: 'Digitraffic AIS' },
  { key: 'news', name: 'GDELT DOC 2.0' },
  { key: 'tension', name: 'Tension Engine' },
  { key: 'eonet', name: 'NASA EONET' },
  { key: 'usgs', name: 'USGS' },
];

function dotColor(status: string, lastFetch: number | null, pollMs: number, now: number): string {
  if (status === 'error') return '#FF3B47';
  if (status === 'loading') return '#5F7484';
  if (!lastFetch) return '#3A4B59';
  if (pollMs > 0 && now - lastFetch > 2 * pollMs) return '#FFB020';
  return '#3DF58A';
}

function utcClock(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export default function Navbar() {
  const state = useLiveState();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const tension = state.tension.data.global;
  const tensionLevel = tension != null ? levelFor(tension) : null;
  const tensionColor = tensionLevel ? LEVEL_COLORS[tensionLevel] : 'var(--ink-faint)';

  return (
    <header className="sticky top-0 z-50 h-12 shrink-0 border-b border-wf-line bg-bg-1/95 backdrop-blur-sm">
      <div className="flex h-full items-center gap-4 px-4">
        {/* brand */}
        <NavLink to="/" className="flex shrink-0 items-center gap-2.5">
          <img src="/logo.svg" alt="WATCHFLOOR" className="h-6 w-6" />
          <span className="font-display text-sm font-semibold tracking-[0.14em] text-wf-ink">WATCHFLOOR</span>
          <span className="hidden font-display text-[10px] font-medium tracking-[0.14em] text-wf-ink-faint xl:inline">
            OSINT COMMAND DECK
          </span>
        </NavLink>

        {/* page nav */}
        <nav className="ml-2 hidden items-center gap-0.5 md:flex">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === '/'}
              className={({ isActive }) =>
                `relative px-2.5 py-1 font-data text-[11px] uppercase tracking-[0.08em] transition-colors ${
                  isActive ? 'text-wf-cyan' : 'text-wf-ink-dim hover:text-wf-ink'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {l.label}
                  {isActive && <span className="absolute inset-x-2 -bottom-[9px] h-[2px] bg-wf-cyan" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="flex-1" />

        {/* global tension chip */}
        <div
          className="hidden items-center gap-2 border border-wf-line px-2.5 py-1 sm:flex"
          style={{ borderColor: tension != null ? `${tensionColor}55` : undefined }}
          title="Mean of top-5 zone scores — derived from GDELT, not a forecast"
        >
          <span className="font-data text-[10px] uppercase text-wf-ink-faint">Tension</span>
          <span className="font-data text-[11px] font-bold tabular-nums" style={{ color: tensionColor }}>
            {tension != null ? tension.toFixed(1) : '——'}
          </span>
          <span className="font-data text-[10px] uppercase" style={{ color: tensionColor }}>
            {tensionLevel ?? 'SYNC'}
          </span>
        </div>

        {/* UTC clock */}
        <div className="font-data text-[13px] tabular-nums text-wf-ink">
          {utcClock(now)}
          <span className="ml-1 text-[10px] text-wf-ink-faint">UTC</span>
        </div>

        {/* source status dots */}
        <div className="hidden items-center gap-1.5 lg:flex">
          {SOURCE_DOTS.map(({ key, name }) => {
            const s = state[key];
            const c = dotColor(s.status, s.lastFetch, s.pollMs, now);
            return (
              <span
                key={key}
                title={`${name} — ${s.status === 'error' ? `ERROR: ${s.error ?? ''}` : `last fetch ${ageLabel(s.lastFetch, now)} ago`}`}
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: c, boxShadow: `0 0 5px ${c}` }}
              />
            );
          })}
        </div>
      </div>
    </header>
  );
}
