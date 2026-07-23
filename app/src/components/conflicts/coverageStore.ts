/**
 * Per-zone GDELT coverage store for the Conflicts page.
 *
 * Every zone's artlist query goes through the SHARED GDELT request queue
 * (src/lib/sources.ts — 6s global spacing, 15-min response cache), so this
 * page never violates the 1 req / 5s rate limit and re-mounts are free.
 * Articles trickle in zone-by-zone; cards render honest SYNC/ERROR states
 * until their zone resolves. No mock data anywhere.
 *
 * Module-level store + useSyncExternalStore (same pattern as useLiveStore).
 */

import { useSyncExternalStore } from 'react';
import { CADENCE, gdeltDocUrl, gdeltFetch } from '@/lib/sources';
import type { GdeltArtlistResponse } from '@/lib/sources';
import { CONFLICT_ZONES } from '@/lib/zones';
import type { ConflictZone } from '@/lib/zones';

export interface ZoneArticle {
  title: string;
  url: string;
  domain: string;
  sourceCountry: string;
  seenDate: string; // raw GDELT seendate, e.g. "20260723T143000Z"
  tone: number | null; // only present if GDELT returns it (usually not in artlist)
}

export type CoverageStatus = 'idle' | 'loading' | 'live' | 'error';

export interface ZoneCoverage {
  status: CoverageStatus;
  articles: ZoneArticle[];
  lastFetch: number | null;
  lastAttempt: number | null;
  error: string | null;
}

export type CoverageMap = Record<string, ZoneCoverage>;

const IDLE: ZoneCoverage = { status: 'idle', articles: [], lastFetch: null, lastAttempt: null, error: null };

let coverage: CoverageMap = {};
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function patch(zoneId: string, partial: Partial<ZoneCoverage>) {
  coverage = { ...coverage, [zoneId]: { ...(coverage[zoneId] ?? IDLE), ...partial } };
  emit();
}

function parseArticles(res: GdeltArtlistResponse): ZoneArticle[] {
  return (res.articles ?? [])
    .filter((a) => a.title && a.url)
    .map((a) => ({
      title: a.title,
      url: a.url,
      domain: a.domain ?? '',
      sourceCountry: a.sourcecountry ?? '',
      seenDate: a.seendate ?? '',
      tone: typeof (a as { tone?: unknown }).tone === 'number' ? ((a as { tone?: number }).tone ?? null) : null,
    }));
}

/** Fetch one zone's latest articles through the shared queue (15-min cache). */
export async function fetchZoneArticles(zone: ConflictZone, maxrecords = 25): Promise<ZoneArticle[]> {
  const url = `${gdeltDocUrl({ query: zone.gdeltQuery, mode: 'artlist', maxrecords, timespan: '24h' })}&sort=hybridrel`;
  const res = await gdeltFetch<GdeltArtlistResponse>(url);
  return parseArticles(res);
}

/* ---------------- sequential driver (one zone at a time) ---------------- */

let started = false;
let running = false;

async function runDriver(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const zone of CONFLICT_ZONES) {
      const cur = coverage[zone.id];
      const fresh = cur?.status === 'live' && cur.lastFetch && Date.now() - cur.lastFetch < CADENCE.gdelt;
      if (fresh) continue;
      patch(zone.id, { status: cur?.lastFetch ? cur.status : 'loading', lastAttempt: Date.now(), error: null });
      try {
        const articles = await fetchZoneArticles(zone, 25);
        patch(zone.id, { status: 'live', articles, lastFetch: Date.now(), error: null });
      } catch (err) {
        patch(zone.id, { status: 'error', error: err instanceof Error ? err.message : 'GDELT fetch failed' });
      }
    }
  } finally {
    running = false;
  }
}

/**
 * Start the coverage driver (idempotent). Runs immediately, then re-checks
 * every GDELT cache window; zones fresher than 15 min are skipped (their
 * URLs resolve from the shared cache anyway).
 */
export function ensureCoverageStarted(): void {
  if (started) return;
  started = true;
  // yield the first queue slots to the news wire + tension engine
  window.setTimeout(() => void runDriver(), 20_000);
  window.setInterval(() => void runDriver(), CADENCE.gdelt);
}

/* ---------------- React bindings ---------------- */

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useCoverageMap(): CoverageMap {
  return useSyncExternalStore(subscribe, () => coverage, () => coverage);
}

export function useZoneCoverage(zoneId: string): ZoneCoverage {
  const map = useCoverageMap();
  return map[zoneId] ?? IDLE;
}

/* ---------------- formatting helpers ---------------- */

/** GDELT seendate "20260723T143000Z" → "2026-07-23 14:30Z". */
export function formatSeenDate(raw: string): string {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
  if (!m) return raw || '—';
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}Z`;
}

/** Epoch ms → "2026-07-23 14:30:05Z". */
export function formatUtc(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
}
