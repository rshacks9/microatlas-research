/**
 * Live fetchers + polling orchestrator. Every function fetches real data
 * and throws on failure — the store records LIVE / ERROR accordingly.
 * startLivePolling() is idempotent; call once from the app root.
 */

import {
  CADENCE,
  ENDPOINTS,
  TLE_GROUPS,
  TLE_GROUP_CAPS,
  fetchViaProxyChain,
  gdeltDocUrl,
  gdeltFetch,
} from './sources';
import type { GdeltArtlistResponse } from './sources';
import { countryCentroid } from './countries';
import { CONFLICT_ZONES } from './zones';
import { fetchAllTensions, globalTension, readTensionHistory, appendTensionHistory } from './tension';
import { liveStore } from '@/store/useLiveStore';
import type { AircraftTrack, NaturalEvent, NewsItem, SatelliteTle, ShipTrack } from '@/store/useLiveStore';

/* ------------------------------------------------------------------ */
/* CelesTrak TLE                                                        */
/* ------------------------------------------------------------------ */

/** Parse TLE epoch (line 1, cols 19–32: YYDDD.DDDDDDDD) → epoch ms. */
export function tleEpochMs(tle1: string): number | null {
  try {
    const year = parseInt(tle1.slice(18, 20), 10);
    const day = parseFloat(tle1.slice(20, 32));
    if (!Number.isFinite(year) || !Number.isFinite(day)) return null;
    const fullYear = year < 57 ? 2000 + year : 1900 + year;
    return Date.UTC(fullYear, 0, 1) + (day - 1) * 86_400_000;
  } catch {
    return null;
  }
}

export function parseTleText(text: string, group: string, cap: number): SatelliteTle[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd());
  const out: SatelliteTle[] = [];
  for (let i = 0; i + 2 < lines.length && out.length < cap; i++) {
    const l1 = lines[i + 1];
    const l2 = lines[i + 2];
    if (l1?.startsWith('1 ') && l2?.startsWith('2 ')) {
      const name = lines[i].replace(/^0 /, '').trim();
      const norad = parseInt(l1.slice(2, 7), 10);
      if (name && Number.isFinite(norad)) {
        out.push({ name, norad, tle1: l1, tle2: l2, group, epochMs: tleEpochMs(l1) });
      }
      i += 2;
    }
  }
  return out;
}

export async function fetchTles(): Promise<SatelliteTle[]> {
  const results = await Promise.allSettled(
    TLE_GROUPS.map(async (group) => {
      const res = await fetch(ENDPOINTS.celestrak(group), { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseTleText(await res.text(), group, TLE_GROUP_CAPS[group] ?? 100);
    }),
  );
  const sats = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (sats.length === 0) throw new Error('All CelesTrak group fetches failed');
  return sats;
}

/* ------------------------------------------------------------------ */
/* adsb.lol aircraft                                                    */
/* ------------------------------------------------------------------ */

interface AdsbAc {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | string;
  gs?: number;
  track?: number;
  squawk?: string;
  t?: string;
  seen?: number;
}

function parseAircraft(json: { ac?: AdsbAc[] }): AircraftTrack[] {
  return (json.ac ?? [])
    .filter((a) => typeof a.lat === 'number' && typeof a.lon === 'number' && a.hex)
    .map((a) => ({
      hex: a.hex!,
      flight: (a.flight ?? '').trim(),
      lat: a.lat!,
      lon: a.lon!,
      altBaro: typeof a.alt_baro === 'number' ? a.alt_baro : null,
      gs: typeof a.gs === 'number' ? a.gs : null,
      track: typeof a.track === 'number' ? a.track : null,
      squawk: a.squawk ?? null,
      type: a.t ?? null,
      seenSec: typeof a.seen === 'number' ? a.seen : null,
    }));
}

/**
 * Poll adsb.lol over a small grid of points (viewport center + hotspots),
 * de-duped by ICAO hex, through the CORS proxy chain.
 */
export async function fetchAircraft(points: Array<[number, number]>, distNm = 250): Promise<AircraftTrack[]> {
  const results = await Promise.allSettled(
    points.slice(0, 4).map(async ([lat, lon]) => {
      const { response } = await fetchViaProxyChain(ENDPOINTS.adsb(lat, lon, distNm));
      return parseAircraft(await response.json());
    }),
  );
  const byHex = new Map<string, AircraftTrack>();
  for (const r of results) {
    if (r.status === 'fulfilled') for (const ac of r.value) byHex.set(ac.hex, ac);
  }
  if (byHex.size === 0 && results.every((r) => r.status === 'rejected')) {
    throw new Error('adsb.lol unreachable via proxy chain');
  }
  return [...byHex.values()];
}

/* ------------------------------------------------------------------ */
/* Digitraffic AIS (Baltic / Finland coverage — labeled in UI)          */
/* ------------------------------------------------------------------ */

interface AisFeature {
  type: 'Feature';
  mmsi?: number;
  geometry?: { coordinates?: [number, number] };
  properties?: { sog?: number; cog?: number; heading?: number; timestampExternal?: number; name?: string };
}

export async function fetchShips(): Promise<ShipTrack[]> {
  const res = await fetch(ENDPOINTS.digitrafficAis, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { features?: AisFeature[] };
  const ships = (json.features ?? [])
    .filter((f) => f.mmsi && f.geometry?.coordinates)
    .map((f) => ({
      mmsi: f.mmsi!,
      name: f.properties?.name ?? null,
      lon: f.geometry!.coordinates![0],
      lat: f.geometry!.coordinates![1],
      sog: typeof f.properties?.sog === 'number' ? f.properties.sog : null,
      cog: typeof f.properties?.cog === 'number' ? f.properties.cog : null,
      heading: typeof f.properties?.heading === 'number' && f.properties.heading !== 511 ? f.properties.heading : null,
      timestampMs: typeof f.properties?.timestampExternal === 'number' ? f.properties.timestampExternal : null,
    }));
  if (ships.length === 0) throw new Error('Digitraffic AIS returned no vessels');
  return ships;
}

/* ------------------------------------------------------------------ */
/* GDELT news wire                                                      */
/* ------------------------------------------------------------------ */

export const NEWS_QUERY =
  '(airstrike OR offensive OR missile OR frontline OR ceasefire OR troops OR clash OR escalation)';

export async function fetchNews(max = 25): Promise<NewsItem[]> {
  const url = `${gdeltDocUrl({ query: NEWS_QUERY, mode: 'artlist', maxrecords: max, timespan: '24h' })}&sort=datedesc`;
  const res = await gdeltFetch<GdeltArtlistResponse>(url);
  const items = (res.articles ?? []).map((a) => {
    const c = countryCentroid(a.sourcecountry);
    return {
      title: a.title,
      url: a.url,
      domain: a.domain,
      sourceCountry: a.sourcecountry,
      seenDate: a.seendate,
      lat: c ? c[0] : null,
      lon: c ? c[1] : null,
      approx: !!c,
    };
  });
  if (items.length === 0) throw new Error('GDELT returned no articles');
  return items;
}

/* ------------------------------------------------------------------ */
/* EONET + USGS natural events                                          */
/* ------------------------------------------------------------------ */

export async function fetchEonet(): Promise<NaturalEvent[]> {
  const res = await fetch(ENDPOINTS.eonet, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as {
    events?: Array<{
      id: string;
      title: string;
      categories?: Array<{ title: string }>;
      geometry?: Array<{ date: string; coordinates: [number, number] }>;
      link?: string;
    }>;
  };
  const events = (json.events ?? [])
    .filter((e) => e.geometry?.length)
    .map((e) => {
      const g = e.geometry![e.geometry!.length - 1];
      return {
        id: e.id,
        kind: 'eonet' as const,
        title: e.title,
        category: e.categories?.[0]?.title ?? 'EVENT',
        lon: g.coordinates[0],
        lat: g.coordinates[1],
        magnitude: null,
        timeMs: g.date ? Date.parse(g.date) : null,
        url: e.link ?? null,
      };
    });
  if (events.length === 0) throw new Error('EONET returned no events');
  return events;
}

export async function fetchUsgs(): Promise<NaturalEvent[]> {
  const res = await fetch(ENDPOINTS.usgs, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{
      id: string;
      geometry?: { coordinates?: [number, number, number] };
      properties?: { mag?: number; place?: string; time?: number; url?: string };
    }>;
  };
  const events = (json.features ?? [])
    .filter((f) => f.geometry?.coordinates)
    .map((f) => ({
      id: f.id,
      kind: 'usgs' as const,
      title: f.properties?.place ?? 'Earthquake',
      category: 'EARTHQUAKE',
      lon: f.geometry!.coordinates![0],
      lat: f.geometry!.coordinates![1],
      magnitude: typeof f.properties?.mag === 'number' ? f.properties.mag : null,
      timeMs: typeof f.properties?.time === 'number' ? f.properties.time : null,
      url: f.properties?.url ?? null,
    }));
  if (events.length === 0) throw new Error('USGS returned no earthquakes');
  return events;
}

/* ------------------------------------------------------------------ */
/* Polling orchestrator                                                 */
/* ------------------------------------------------------------------ */

let started = false;
const timers: number[] = [];

function schedule(key: 'tle' | 'aircraft' | 'ships' | 'news' | 'eonet' | 'usgs', fn: () => Promise<void>, pollMs: number) {
  const tick = async () => {
    liveStore.markLoading(key);
    try {
      await fn();
    } catch (err) {
      liveStore.markError(key, err instanceof Error ? err.message : 'fetch failed');
    }
  };
  void tick();
  timers.push(window.setInterval(() => void tick(), pollMs));
}

/** Hotspot grid for the ADS-B poller: rotating conflict-zone centroids. */
let hotspotIdx = 0;
function adsbPoints(): Array<[number, number]> {
  const zs = CONFLICT_ZONES;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 4; i++) pts.push(zs[(hotspotIdx + i) % zs.length].centroid);
  hotspotIdx = (hotspotIdx + 4) % zs.length;
  return pts;
}

async function runTensionEngine(): Promise<void> {
  const prev = liveStore.get().tension.data;
  const zones = { ...prev.zones };
  await fetchAllTensions(
    CONFLICT_ZONES,
    (score) => {
      zones[score.zoneId] = score;
      const g = globalTension(zones);
      liveStore.markLive(
        'tension',
        {
          zones: { ...zones },
          global: g,
          history: g != null ? appendTensionHistory(g) : readTensionHistory(),
          scored: Object.keys(zones).length,
          total: CONFLICT_ZONES.length,
        },
        Object.keys(zones).length,
      );
    },
    zones,
  );
  if (Object.keys(liveStore.get().tension.data.zones).length === 0) {
    throw new Error('Tension engine: no zones scored');
  }
}

/**
 * Start all live polling (idempotent). Slices update as data lands;
 * failures set ERROR with the last good data retained.
 */
export function startLivePolling(): void {
  if (started) return;
  started = true;

  schedule('tle', async () => {
    const sats = await fetchTles();
    liveStore.markLive('tle', sats, sats.length);
  }, CADENCE.tle);
  schedule('aircraft', async () => {
    const ac = await fetchAircraft(adsbPoints());
    liveStore.markLive('aircraft', ac, ac.length);
  }, CADENCE.aircraft);
  schedule('ships', async () => {
    const s = await fetchShips();
    liveStore.markLive('ships', s, s.length);
  }, CADENCE.ships);
  schedule('news', async () => {
    const n = await fetchNews();
    liveStore.markLive('news', n, n.length);
  }, CADENCE.gdelt);
  schedule('eonet', async () => {
    const e = await fetchEonet();
    liveStore.markLive('eonet', e, e.length);
  }, CADENCE.eonet);
  schedule('usgs', async () => {
    const q = await fetchUsgs();
    liveStore.markLive('usgs', q, q.length);
  }, CADENCE.usgs);

  const tensionTick = async () => {
    liveStore.markLoading('tension');
    try {
      await runTensionEngine();
    } catch (err) {
      liveStore.markError('tension', err instanceof Error ? err.message : 'tension engine failed');
    }
  };
  // slight delay so the first GDELT slot goes to the news wire
  timers.push(window.setTimeout(() => void tensionTick(), 8_000));
  timers.push(window.setInterval(() => void tensionTick(), CADENCE.tension));
}

export function stopLivePolling(): void {
  timers.forEach((t) => window.clearInterval(t));
  timers.length = 0;
  started = false;
}
