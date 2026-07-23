/**
 * BootSequence — full-screen overlay (~2.2s, skippable on click).
 * Log lines resolve as the app's REAL first fetches complete — failed
 * sources honestly show [ERROR]. Progress bar tracks real completion.
 * GSAP for emblem draw-on + exit; ends at first-fetch completion or a
 * 2.5s floor / 9s cap, whichever comes first.
 */

import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useLiveState } from '@/store/useLiveStore';
import type { SourceKey } from '@/store/useLiveStore';

interface BootLine {
  key: SourceKey | 'tension';
  label: string;
  unit: (records: number) => string;
}

const LINES: BootLine[] = [
  { key: 'tle', label: 'UPLINK CELESTRAK TLE', unit: (r) => `${r.toLocaleString()} OBJECTS` },
  { key: 'aircraft', label: 'UPLINK ADSB.LOL ADS-B', unit: (r) => `${r.toLocaleString()} AIRCRAFT` },
  { key: 'ships', label: 'UPLINK DIGITRAFFIC AIS', unit: (r) => `${r.toLocaleString()} VESSELS` },
  { key: 'news', label: 'UPLINK GDELT DOC 2.0', unit: (r) => `${r.toLocaleString()} SIGNALS` },
  { key: 'eonet', label: 'UPLINK EONET / USGS', unit: (r) => `${r.toLocaleString()} EVENTS` },
  { key: 'tension', label: 'TENSION ENGINE', unit: (r) => `${r.toLocaleString()} ZONES SCORED` },
];

export default function BootSequence({ onDone }: { onDone: () => void }) {
  const state = useLiveState();
  const rootRef = useRef<HTMLDivElement>(null);
  const [exiting, setExiting] = useState(false);
  const doneRef = useRef(false);
  const startRef = useRef(Date.now());

  const resolved = LINES.map((l) => {
    const s = state[l.key as SourceKey];
    return { line: l, status: s.status, records: l.key === 'eonet' ? state.eonet.records + state.usgs.records : s.records };
  });
  const settledCount = resolved.filter((r) => r.status === 'live' || r.status === 'error').length;
  const allSettled = settledCount === LINES.length;
  const progress = settledCount / LINES.length;

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setExiting(true);
  };

  /* GSAP: emblem draw-on, ring rotation, title stagger, exit */
  useEffect(() => {
    if (!rootRef.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.boot-emblem .emblem-globe circle, .boot-emblem .emblem-globe ellipse, .boot-emblem .emblem-globe line',
        { strokeDasharray: 900, strokeDashoffset: 900 },
        { strokeDashoffset: 0, duration: 0.9, ease: 'power2.inOut', stagger: 0.05 },
      );
      gsap.fromTo('.boot-emblem .emblem-ring', { rotation: 0, transformOrigin: '50% 50%' }, { rotation: 90, duration: 2, ease: 'none' });
      gsap.fromTo(
        '.boot-title span',
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.4, stagger: 0.03, ease: 'power3.out', delay: 0.3 },
      );
    }, rootRef);
    return () => ctx.revert();
  }, []);

  /* exit animation */
  useEffect(() => {
    if (!exiting || !rootRef.current) return;
    const ctx = gsap.context(() => {
      gsap.to(rootRef.current, { scale: 1.04, opacity: 0, duration: 0.5, ease: 'power2.in', onComplete: onDone });
    }, rootRef);
    return () => ctx.revert();
  }, [exiting, onDone]);

  /* finish conditions: all settled (after 2.5s floor) or 9s cap */
  useEffect(() => {
    const elapsed = Date.now() - startRef.current;
    if (allSettled && elapsed >= 2500) {
      finish();
      return;
    }
    if (elapsed >= 9000) {
      finish();
      return;
    }
    const t = window.setTimeout(() => {
      const e2 = Date.now() - startRef.current;
      if (e2 >= 9000) finish();
    }, 1000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSettled, settledCount]);

  return (
    <div
      ref={rootRef}
      onClick={finish}
      className="fixed inset-0 z-[100] flex cursor-pointer flex-col items-center justify-center bg-bg-0"
    >
      <img src="/emblem.svg" alt="" className="boot-emblem h-40 w-40" />
      <h1 className="boot-title mt-6 font-display text-[40px] font-bold leading-[44px] tracking-[0.14em] text-wf-ink">
        {'WATCHFLOOR'.split('').map((c, i) => (
          <span key={i}>{c}</span>
        ))}
      </h1>
      <div className="mt-1 font-display text-[11px] font-medium uppercase tracking-[0.14em] text-wf-ink-dim">
        Global OSINT Command Deck
      </div>

      <div className="mt-8 w-[360px] space-y-1.5">
        {resolved.map(({ line, status, records }, i) => (
          <div key={line.key} className="flex items-baseline font-data text-[11px]" style={{ transitionDelay: `${i * 120}ms` }}>
            <span className="text-wf-ink-dim">
              ▸ {line.label} {'.'.repeat(Math.max(2, 30 - line.label.length))}
            </span>
            <span className="ml-2 whitespace-nowrap">
              {status === 'live' && (
                <>
                  <span className="font-bold text-wf-green">[LIVE]</span>{' '}
                  <span className="text-wf-ink-dim">{line.unit(records)}</span>
                </>
              )}
              {status === 'error' && <span className="font-bold text-wf-red">[ERROR]</span>}
              {(status === 'idle' || status === 'loading') && <span className="text-wf-ink-faint">[SYNC…]</span>}
              {status === 'stale' && <span className="font-bold text-wf-amber">[STALE]</span>}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-8 h-px w-60 bg-wf-line">
        <div className="h-px bg-wf-cyan transition-all duration-300" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="mt-3 font-data text-[11px] text-wf-ink-faint">CLICK TO ENTER / SKIP</div>
    </div>
  );
}
