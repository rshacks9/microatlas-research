/**
 * Footer (scroll pages only) — mission, data provenance list, disclaimer.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useLiveState, ageLabel } from '@/store/useLiveStore';
import type { SourceKey } from '@/store/useLiveStore';

const PROVENANCE: Array<{ key: SourceKey; name: string }> = [
  { key: 'tle', name: 'CelesTrak TLE' },
  { key: 'aircraft', name: 'adsb.lol ADS-B' },
  { key: 'ships', name: 'Digitraffic AIS' },
  { key: 'news', name: 'GDELT DOC 2.0' },
  { key: 'tension', name: 'Tension Engine' },
  { key: 'eonet', name: 'NASA EONET' },
  { key: 'usgs', name: 'USGS' },
];

export default function Footer() {
  const state = useLiveState();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');

  return (
    <footer className="border-t border-wf-line bg-bg-1">
      <div className="mx-auto grid max-w-[1440px] gap-8 px-6 py-10 md:grid-cols-3">
        <div>
          <div className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="" className="h-6 w-6" />
            <span className="font-display text-sm font-semibold tracking-[0.14em] text-wf-ink">WATCHFLOOR</span>
          </div>
          <p className="mt-3 font-body text-xs leading-5 text-wf-ink-dim">
            A live open-source-intelligence operations console: real satellites, real traffic,
            real signals — streamed straight from public sources to your browser.
          </p>
        </div>

        <div>
          <div className="font-display text-[11px] font-medium uppercase tracking-[0.14em] text-wf-ink-faint">
            Data Provenance
          </div>
          <ul className="mt-3 space-y-1.5">
            {PROVENANCE.map(({ key, name }) => {
              const s = state[key];
              const ok = s.status === 'live';
              const err = s.status === 'error';
              return (
                <li key={key} className="flex items-center gap-2 font-data text-[11px] text-wf-ink-dim">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: err ? '#FF3B47' : ok ? '#3DF58A' : '#3A4B59' }}
                  />
                  <span>{name}</span>
                  <span className="text-wf-ink-faint">{ageLabel(s.lastFetch, now)}</span>
                </li>
              );
            })}
          </ul>
          <Link to="/sources" className="mt-3 inline-block font-data text-[11px] text-wf-cyan hover:underline">
            FULL REGISTRY →
          </Link>
        </div>

        <div>
          <p className="font-body text-xs leading-5 text-wf-ink-faint">
            All data fetched live from public sources at view time. Derived indicators are
            analytical signals, not predictions of certainty. Approximate geolocations are
            labeled. Not affiliated with any government.
          </p>
          <div className="mt-4 font-data text-[11px] text-wf-ink-faint">
            UTC {p(d.getUTCHours())}:{p(d.getUTCMinutes())}:{p(d.getUTCSeconds())}
          </div>
        </div>
      </div>
    </footer>
  );
}
