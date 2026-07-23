/**
 * Tension engine (design contract, design.md §8):
 * per curated zone fetch GDELT timelinevol (7d) + timelinetone (7d);
 * compute volume z-score vs 7-day baseline + tone delta → 0–100 score
 * → 5-level alert scale. Always labeled a derived indicator, not a forecast.
 *
 * Requests go through the global GDELT queue (6s spacing, 15-min cache).
 * Zones are batched: GDELT timeline modes return one series per
 * parenthetical phrase group, so each zone contributes a single
 * location-keyword group and several zones ride one HTTP request.
 */

import { gdeltDocUrl, gdeltFetch } from './sources';
import type { GdeltTimelineResponse } from './sources';
import type { ConflictZone } from './zones';

export type TensionLevel = 'LOW' | 'GUARDED' | 'ELEVATED' | 'HIGH' | 'CRITICAL';

export const LEVEL_COLORS: Record<TensionLevel, string> = {
  LOW: '#2EE6C8',
  GUARDED: '#4EA8FF',
  ELEVATED: '#FFB020',
  HIGH: '#FF7A45',
  CRITICAL: '#FF3B47',
};

export function levelFor(score: number): TensionLevel {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 40) return 'ELEVATED';
  if (score >= 20) return 'GUARDED';
  return 'LOW';
}

export interface ZoneScore {
  zoneId: string;
  score: number; // 0–100
  level: TensionLevel;
  delta: number; // change vs previous computation
  zVol: number;
  toneDelta: number;
  computedAt: number; // epoch ms
  latestVol: number;
  latestTone: number | null;
}

/** Single parenthetical location-keyword group used for timeline batching. */
export function zoneTimelineGroup(zone: ConflictZone): string {
  const q = zone.gdeltQuery.trim();
  // take the first parenthetical group, e.g. "(ukraine OR donetsk OR zaporizhzhia)"
  const m = q.match(/\([^)]*\)/);
  return m ? m[0] : `(${q})`;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1));
}

/**
 * Score one zone from its daily volume + tone series (7d, oldest→newest).
 * zVol: z-score of the latest bucket vs the baseline (clamped −3..+6).
 * toneDelta: baseline tone minus latest tone (positive = darker coverage).
 */
export function computeScore(vol: number[], tone: number[]): { score: number; zVol: number; toneDelta: number } {
  const v = vol.filter((x) => Number.isFinite(x));
  if (v.length === 0) return { score: 0, zVol: 0, toneDelta: 0 };
  const latest = v[v.length - 1];
  const base = v.slice(0, -1);
  const sd = stdev(base) || Math.max(mean(base) * 0.15, 1e-6);
  const zVol = Math.max(-3, Math.min(6, (latest - mean(base)) / sd));

  let toneDelta = 0;
  const t = tone.filter((x) => Number.isFinite(x));
  if (t.length >= 2) {
    toneDelta = mean(t.slice(0, -1)) - t[t.length - 1];
    toneDelta = Math.max(-6, Math.min(6, toneDelta));
  }

  const raw = 50 + zVol * 8 + toneDelta * 4;
  const score = Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
  return { score, zVol: Math.round(zVol * 100) / 100, toneDelta: Math.round(toneDelta * 100) / 100 };
}

/* ------------------------------------------------------------------ */
/* Fetching                                                             */
/* ------------------------------------------------------------------ */

function seriesValues(res: GdeltTimelineResponse, index: number): number[] {
  const s = res.timeline?.[index];
  if (!s?.data) return [];
  return s.data.map((d) => d.value).filter((x) => typeof x === 'number');
}

async function fetchZoneBatch(
  zones: ConflictZone[],
  mode: 'timelinevol' | 'timelinetone',
): Promise<number[][]> {
  const query = zones.map(zoneTimelineGroup).join(' ');
  const url = gdeltDocUrl({ query, mode, timespan: '7d' });
  const res = await gdeltFetch<GdeltTimelineResponse>(url);
  const count = res.timeline?.length ?? 0;
  if (count < zones.length) throw new Error(`GDELT returned ${count}/${zones.length} series`);
  return zones.map((_, i) => seriesValues(res, i));
}

async function fetchZoneSingle(
  zone: ConflictZone,
  mode: 'timelinevol' | 'timelinetone',
): Promise<number[]> {
  const url = gdeltDocUrl({ query: zoneTimelineGroup(zone), mode, timespan: '7d' });
  const res = await gdeltFetch<GdeltTimelineResponse>(url);
  return res.timeline?.flatMap((s) => s.data?.map((d) => d.value) ?? []) ?? [];
}

export interface TensionProgress {
  done: number;
  total: number;
}

const BATCH = 6; // zones per HTTP request — keeps the 6s queue shallow

/**
 * Score all zones. Emits each ZoneScore via onZone as soon as its batch
 * resolves (UI updates incrementally). Batched request per 6 zones with
 * per-zone fallback when GDELT refuses multi-series.
 */
export async function fetchAllTensions(
  zones: ConflictZone[],
  onZone: (score: ZoneScore, prev: ZoneScore | undefined) => void,
  prevScores: Record<string, ZoneScore>,
  onProgress?: (p: TensionProgress) => void,
): Promise<void> {
  const batches: ConflictZone[][] = [];
  for (let i = 0; i < zones.length; i += BATCH) batches.push(zones.slice(i, i + BATCH));

  let done = 0;
  for (const batch of batches) {
    let vols: number[][] | null = null;
    let tones: number[][] | null = null;
    try {
      [vols, tones] = await Promise.all([
        fetchZoneBatch(batch, 'timelinevol'),
        fetchZoneBatch(batch, 'timelinetone'),
      ]);
    } catch {
      // fallback: per-zone requests through the same queue
      vols = await Promise.all(batch.map((z) => fetchZoneSingle(z, 'timelinevol').catch(() => [] as number[])));
      tones = await Promise.all(batch.map((z) => fetchZoneSingle(z, 'timelinetone').catch(() => [] as number[])));
    }
    const now = Date.now();
    batch.forEach((zone, i) => {
      const vol = vols?.[i] ?? [];
      if (vol.length === 0) {
        done++;
        onProgress?.({ done, total: zones.length });
        return; // leave previous score in place; slice ages to STALE
      }
      const { score, zVol, toneDelta } = computeScore(vol, tones?.[i] ?? []);
      const prev = prevScores[zone.id];
      const zs: ZoneScore = {
        zoneId: zone.id,
        score,
        level: levelFor(score),
        delta: prev ? Math.round((score - prev.score) * 10) / 10 : 0,
        zVol,
        toneDelta,
        computedAt: now,
        latestVol: vol[vol.length - 1],
        latestTone: tones?.[i]?.length ? tones[i][tones[i].length - 1] : null,
      };
      onZone(zs, prev);
      done++;
      onProgress?.({ done, total: zones.length });
    });
  }
}

/** Global tension = mean of the top-5 zone scores (design.md §8). */
export function globalTension(zones: Record<string, ZoneScore>): number | null {
  const scores = Object.values(zones)
    .map((z) => z.score)
    .sort((a, b) => b - a)
    .slice(0, 5);
  if (scores.length === 0) return null;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}

/* ------------------------------------------------------------------ */
/* 24h sparkline history (localStorage, survives reloads)               */
/* ------------------------------------------------------------------ */

const HISTORY_KEY = 'wf-tension-history';
const HISTORY_MAX = 96; // 24h at 15-min cadence

export function readTensionHistory(): Array<{ t: number; v: number }> {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Array<{ t: number; v: number }>;
    return Array.isArray(arr) ? arr.filter((p) => typeof p?.t === 'number' && typeof p?.v === 'number') : [];
  } catch {
    return [];
  }
}

export function appendTensionHistory(v: number): Array<{ t: number; v: number }> {
  const hist = readTensionHistory();
  const now = Date.now();
  if (hist.length && now - hist[hist.length - 1].t < 10 * 60_000) return hist; // avoid duplicates
  hist.push({ t: now, v });
  while (hist.length > HISTORY_MAX) hist.shift();
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
  } catch {
    /* storage full/blocked — history is best-effort */
  }
  return hist;
}
