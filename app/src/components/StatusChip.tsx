/**
 * StatusChip — 8px dot + label + age (`LIVE · 12s`).
 * LIVE green (<2× poll), STALE amber (2–5×), ERROR red, LOADING dim.
 */

import { useEffect, useState } from 'react';
import { derivedStatus, ageLabel } from '@/store/useLiveStore';
import type { Slice } from '@/store/useLiveStore';

const DOT_COLORS: Record<string, string> = {
  live: '#3DF58A',
  stale: '#FFB020',
  error: '#FF3B47',
  loading: '#5F7484',
  idle: '#3A4B59',
};

export default function StatusChip({
  slice,
  label,
  showAge = true,
  className = '',
}: {
  slice: Pick<Slice<unknown>, 'status' | 'lastFetch' | 'pollMs'>;
  label?: string;
  showAge?: boolean;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const status = derivedStatus(slice, now);
  const color = DOT_COLORS[status] ?? DOT_COLORS.idle;
  const text =
    status === 'live' ? 'LIVE' : status === 'stale' ? 'STALE' : status === 'error' ? 'ERROR' : status === 'loading' ? 'SYNC' : 'IDLE';

  return (
    <span className={`inline-flex items-center gap-1.5 font-data text-[10px] uppercase tracking-[0.08em] ${className}`}>
      <span
        className={`inline-block h-2 w-2 rounded-full ${status === 'live' ? 'wf-anim-blink' : ''}`}
        style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
      />
      {label && <span className="text-wf-ink-dim">{label}</span>}
      <span style={{ color }}>{text}</span>
      {showAge && (status === 'live' || status === 'stale') && (
        <span className="text-wf-ink-faint">· {ageLabel(slice.lastFetch, now)}</span>
      )}
    </span>
  );
}
