/**
 * Per-zone tension score history (localStorage, survives reloads).
 * Fed exclusively by the live tension engine's ZoneScore outputs —
 * the Conflicts page appends each engine recompute here and renders
 * card sparklines + Δ24h deltas from it. Never fabricated: a fresh
 * browser simply has a short (honest) history.
 */

import type { ZoneScore } from '@/lib/tension';

const KEY = 'wf-zone-score-history';
const MAX_POINTS = 96; // 24h at 15-min engine cadence
const MIN_GAP_MS = 10 * 60_000; // ignore duplicate recomputes

export interface HistoryPoint {
  t: number;
  v: number;
}

export function readZoneHistory(): Record<string, HistoryPoint[]> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as Record<string, HistoryPoint[]>;
    if (typeof obj !== 'object' || obj === null) return {};
    const out: Record<string, HistoryPoint[]> = {};
    for (const [k, arr] of Object.entries(obj)) {
      if (Array.isArray(arr)) {
        out[k] = arr.filter((p) => typeof p?.t === 'number' && typeof p?.v === 'number');
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Append the latest engine recompute for every scored zone. */
export function appendZoneScores(zones: Record<string, ZoneScore>): Record<string, HistoryPoint[]> {
  const hist = readZoneHistory();
  const now = Date.now();
  let changed = false;
  for (const [id, zs] of Object.entries(zones)) {
    const arr = hist[id] ?? (hist[id] = []);
    const last = arr[arr.length - 1];
    if (last && now - last.t < MIN_GAP_MS) continue;
    arr.push({ t: zs.computedAt || now, v: zs.score });
    while (arr.length > MAX_POINTS) arr.shift();
    changed = true;
  }
  if (changed) {
    try {
      localStorage.setItem(KEY, JSON.stringify(hist));
    } catch {
      /* storage full/blocked — history is best-effort */
    }
  }
  return hist;
}

export interface ZoneDelta {
  value: number;
  /** '24h' = vs the history point nearest 24h ago; 'rescore' = engine delta vs previous computation */
  kind: '24h' | 'rescore';
}

/**
 * Δ24h from cached history when a ≥20h-old point exists; otherwise fall
 * back to the engine's own delta vs the previous computation (labeled).
 */
export function zoneDelta(history: HistoryPoint[], score: ZoneScore): ZoneDelta {
  if (history.length) {
    const target = Date.now() - 24 * 3_600_000;
    let best: HistoryPoint | null = null;
    for (const p of history) {
      if (p.t <= target + 2 * 3_600_000 && (!best || Math.abs(p.t - target) < Math.abs(best.t - target))) best = p;
    }
    if (best && Date.now() - best.t >= 20 * 3_600_000) {
      return { value: Math.round((score.score - best.v) * 10) / 10, kind: '24h' };
    }
  }
  return { value: score.delta, kind: 'rescore' };
}
