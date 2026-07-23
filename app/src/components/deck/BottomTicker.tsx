/**
 * BottomTicker — 32px marquee of the latest GDELT headlines.
 * Hover pauses; click opens /intel. Right cap: next-refresh countdown.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useLiveState } from '@/store/useLiveStore';

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function BottomTicker() {
  const state = useLiveState();
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const items = state.news.data.slice(0, 25);
  const nextRefresh = state.news.lastFetch ? state.news.lastFetch + state.news.pollMs - now : null;

  // marquee duration ∝ content length (~40px/s); each item ~600px
  const dur = Math.max(30, items.length * 15);

  return (
    <div className="relative z-40 flex h-8 shrink-0 items-stretch border-t border-wf-line bg-bg-1/95">
      {/* left cap */}
      <div className="flex shrink-0 items-center gap-2 border-r border-wf-line px-3">
        <span className="wf-anim-blink bg-wf-red px-1.5 py-px font-data text-[10px] font-bold text-bg-0">INTEL</span>
        <span className="hidden font-data text-[10px] uppercase tracking-[0.08em] text-wf-ink-faint sm:inline">
          GDELT Live Wire
        </span>
      </div>

      {/* marquee */}
      <div className="group relative min-w-0 flex-1 overflow-hidden">
        {items.length === 0 ? (
          <div className="flex h-full items-center px-3 font-data text-[11px] text-wf-ink-faint">
            {state.news.status === 'error' ? `WIRE ERROR — ${state.news.error ?? ''}` : 'ACQUIRING GDELT WIRE…'}
          </div>
        ) : (
          <div
            className="wf-anim-marquee flex h-full w-max items-center group-hover:[animation-play-state:paused]"
            style={{ ['--wf-marquee-dur' as string]: `${dur}s` }}
          >
            {[...items, ...items].map((n, i) => (
              <button
                key={`${n.url}-${i}`}
                onClick={() => navigate('/intel')}
                className="flex h-full shrink-0 items-center gap-2 px-4 text-left hover:bg-bg-3"
                title={n.title}
              >
                <span className="border border-wf-line px-1 font-data text-[9px] uppercase text-wf-ink-faint">
                  {(n.sourceCountry || 'INT').slice(0, 3).toUpperCase()}
                </span>
                <span className="max-w-[420px] truncate font-data text-[11px] text-wf-ink-dim">{n.title}</span>
                <span className="text-wf-ink-faint">▪</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* right cap */}
      <div className="flex shrink-0 items-center border-l border-wf-line px-3 font-data text-[10px] tabular-nums text-wf-ink-faint">
        {nextRefresh != null ? `REFRESH ${fmtCountdown(nextRefresh)}` : 'REFRESH --:--'}
      </div>
    </div>
  );
}
