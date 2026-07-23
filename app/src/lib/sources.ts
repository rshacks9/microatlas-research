/**
 * WATCHFLOOR shared data-source infrastructure.
 * Endpoint constants, poll cadences, the GDELT global request queue
 * (6s spacing, 15-min cache) and the CORS proxy chain used for adsb.lol.
 *
 * NO MOCK DATA — everything here fetches live, failures surface as ERROR.
 */

export const ENDPOINTS = {
  /** CelesTrak TLE, FORMAT=tle per GROUP */
  celestrak: (group: string) =>
    `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`,
  /** adsb.lol v2 point query */
  adsb: (lat: number, lon: number, distNm: number) =>
    `https://api.adsb.lol/v2/lat/${lat.toFixed(2)}/lon/${lon.toFixed(2)}/dist/${Math.round(distNm)}`,
  /** Digitraffic AIS (Baltic / Finland coverage) */
  digitrafficAis: 'https://meri.digitraffic.fi/api/ais/v1/locations',
  /** GDELT DOC 2.0 API */
  gdeltDoc: 'https://api.gdeltproject.org/api/v2/doc/doc',
  /** NASA EONET v3 open events */
  eonet: 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50',
  /** USGS M2.5+ past day */
  usgs: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
} as const;

/** Poll cadences in milliseconds (shown verbatim in the UI). */
export const CADENCE = {
  tle: 30 * 60_000,
  sgp4Hz: 1, // local propagation, 1–2 Hz
  aircraft: 12_000,
  ships: 30_000,
  gdelt: 15 * 60_000,
  eonet: 10 * 60_000,
  usgs: 5 * 60_000,
  tension: 15 * 60_000,
} as const;

/** CelesTrak groups pulled for the satellite layer. */
export const TLE_GROUPS = [
  'stations',
  'visual',
  'gps-ops',
  'glo-ops',
  'galileo',
  'beidou',
  'noaa',
  'iridium-NEXT',
  'starlink',
  'last-30-days',
] as const;

/** Per-group caps keep the PointPrimitive budget near ~1500. */
export const TLE_GROUP_CAPS: Record<string, number> = {
  stations: 60,
  visual: 200,
  'gps-ops': 40,
  'glo-ops': 30,
  galileo: 40,
  beidou: 60,
  noaa: 25,
  'iridium-NEXT': 90,
  starlink: 500,
  'last-30-days': 450,
};

/* ------------------------------------------------------------------ */
/* CORS proxy chain: direct → corsproxy.io → allorigins → isomorphic-git */
/* ------------------------------------------------------------------ */

const PROXIES: Array<(url: string) => string> = [
  (u) => u, // direct
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://cors.isomorphic-git.org/${u}`,
];

export interface FetchChainResult {
  response: Response;
  via: 'direct' | 'corsproxy.io' | 'allorigins' | 'isomorphic-git';
}

const VIA_NAMES: FetchChainResult['via'][] = ['direct', 'corsproxy.io', 'allorigins', 'isomorphic-git'];

/**
 * Try each hop of the CORS proxy chain until one returns a usable response.
 * Throws the last error if every hop fails.
 */
export async function fetchViaProxyChain(url: string, init?: RequestInit, timeoutMs = 15_000): Promise<FetchChainResult> {
  let lastError: unknown = null;
  for (let i = 0; i < PROXIES.length; i++) {
    const proxied = PROXIES[i](url);
    try {
      const ctrl = new AbortController();
      const t = window.setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(proxied, { ...init, signal: ctrl.signal });
      window.clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { response: res, via: VIA_NAMES[i] };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All CORS proxy hops failed');
}

/* ------------------------------------------------------------------ */
/* GDELT global request queue — 6s spacing between ALL GDELT requests,  */
/* plus a 15-minute response cache keyed by full URL.                   */
/* ------------------------------------------------------------------ */

const GDELT_SPACING_MS = 6_000;
const GDELT_CACHE_MS = 15 * 60_000;

interface GdeltCacheEntry {
  at: number;
  json: unknown;
}

const gdeltCache = new Map<string, GdeltCacheEntry>();
let gdeltQueue: Promise<unknown> = Promise.resolve();
let gdeltLastAt = 0;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Enqueue a GDELT request. Requests are serialized globally with ≥6s
 * spacing; identical URLs within 15 minutes resolve from cache.
 */
export function gdeltFetch<T = unknown>(url: string): Promise<T> {
  const cached = gdeltCache.get(url);
  if (cached && Date.now() - cached.at < GDELT_CACHE_MS) {
    return Promise.resolve(cached.json as T);
  }
  const run = async (): Promise<T> => {
    const wait = GDELT_SPACING_MS - (Date.now() - gdeltLastAt);
    if (wait > 0) await sleep(wait);
    gdeltLastAt = Date.now();
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 25_000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`GDELT HTTP ${res.status}`);
      const json = (await res.json()) as T;
      gdeltCache.set(url, { at: Date.now(), json });
      return json;
    } finally {
      window.clearTimeout(t);
    }
  };
  const p = gdeltQueue.then(run, run);
  // keep the chain alive regardless of individual failures
  gdeltQueue = p.catch(() => undefined);
  return p;
}

/** Build a GDELT DOC 2.0 query URL. */
export function gdeltDocUrl(params: {
  query: string;
  mode: 'artlist' | 'timelinevol' | 'timelinevolraw' | 'timelinetone';
  maxrecords?: number;
  timespan?: string;
  format?: string;
}): string {
  const q = new URLSearchParams({
    query: params.query,
    mode: params.mode,
    format: params.format ?? 'json',
  });
  if (params.maxrecords) q.set('maxrecords', String(params.maxrecords));
  if (params.timespan) q.set('timespan', params.timespan);
  return `${ENDPOINTS.gdeltDoc}?${q.toString()}`;
}

/* ------------------------------------------------------------------ */
/* Shared types                                                         */
/* ------------------------------------------------------------------ */

export interface GdeltArticle {
  url: string;
  url_mobile?: string;
  title: string;
  seendate: string;
  socialimage?: string;
  domain: string;
  language: string;
  sourcecountry: string;
}

export interface GdeltArtlistResponse {
  articles?: GdeltArticle[];
}

export interface GdeltTimelineDatum {
  date: string;
  value: number;
  norm?: number;
}

export interface GdeltTimelineSeries {
  series?: string;
  data?: GdeltTimelineDatum[];
}

export interface GdeltTimelineResponse {
  timeline?: GdeltTimelineSeries[];
}
