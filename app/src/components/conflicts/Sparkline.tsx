/**
 * Sparkline — 40px tension history line for a zone card.
 * Data: cached engine recomputes (zoneHistory) + the live score.
 * Line colored by alert level, 12% gradient fill, dashed baseline at
 * the engine's neutral score (50). Draws left→right once on reveal.
 */

import { useId, useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { HistoryPoint } from './zoneHistory';

const W = 220;
const H = 40;
const PAD = 2;
const BASELINE = 50; // tension engine neutral score

export default function Sparkline({
  history,
  current,
  color,
}: {
  history: HistoryPoint[];
  current: number | null;
  color: string;
}) {
  const reduce = useReducedMotion();
  const gid = useId().replace(/[^a-zA-Z0-9]/g, '');

  const { line, area } = useMemo(() => {
    const pts = [...history.map((p) => p.v)];
    if (current != null && (pts.length === 0 || pts[pts.length - 1] !== current)) pts.push(current);
    if (pts.length === 0) return { line: '', area: '' };
    const x = (i: number) => PAD + (pts.length === 1 ? (W - 2 * PAD) / 2 : (i / (pts.length - 1)) * (W - 2 * PAD));
    const y = (v: number) => H - PAD - (Math.max(0, Math.min(100, v)) / 100) * (H - 2 * PAD);
    const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(pts.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`;
    return { line, area };
  }, [history, current]);

  const baselineY = H - PAD - (BASELINE / 100) * (H - 2 * PAD);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="block h-10 w-full"
      role="img"
      aria-label="Tension history sparkline"
    >
      <defs>
        <linearGradient id={`wf-spark-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.12" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* empty track — always visible so zero-history zones read honestly */}
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--line)" strokeWidth="1" />
      <line
        x1={PAD}
        y1={baselineY}
        x2={W - PAD}
        y2={baselineY}
        stroke="var(--ink-faint)"
        strokeWidth="1"
        strokeDasharray="3 3"
        opacity="0.6"
      />
      {line && (
        <>
          <path d={area} fill={`url(#wf-spark-${gid})`} stroke="none" />
          {reduce ? (
            <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          ) : (
            <motion.path
              d={line}
              fill="none"
              stroke={color}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              initial={{ pathLength: 0 }}
              whileInView={{ pathLength: 1 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 1, ease: 'easeOut' }}
            />
          )}
        </>
      )}
    </svg>
  );
}
