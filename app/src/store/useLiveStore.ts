/**
 * WATCHFLOOR central live-data store (design.md §8).
 * One slice per source family: { status, lastFetch, error, data, pollMs }.
 * Module-level store + useSyncExternalStore — stable API for all pages.
 *
 * Status model: LIVE (<2× poll), STALE (2–5×), ERROR (fetch failed).
 */

import { useSyncExternalStore } from 'react';
import { CADENCE } from '@/lib/sources';
import type { ZoneScore } from '@/lib/tension';

/* ---------------- data shapes (shared with every page) ---------------- */

export interface SatelliteTle {
  name: string;
  norad: number;
  tle1: string;
  tle2: string;
  group: string;
  epochMs: number | null;
}

export interface AircraftTrack {
  hex: string;
  flight: string;
  lat: number;
  lon: number;
  altBaro: number | null; // feet
  gs: number | null; // knots
  track: number | null; // degrees
  squawk: string | null;
  type: string | null;
  seenSec: number | null;
}

export interface ShipTrack {
  mmsi: number;
  name: string | null;
  lat: number;
  lon: number;
  sog: number | null; // knots
  cog: number | null; // degrees
  heading: number | null;
  timestampMs: number | null;
}

export interface NewsItem {
  title: string;
  url: string;
  domain: string;
  sourceCountry: string;
  seenDate: string;
  lat: number | null;
  lon: number | null;
  approx: boolean;
}

export interface NaturalEvent {
  id: string;
  kind: 'eonet' | 'usgs';
  title: string;
  category: string;
  lat: number;
  lon: number;
  magnitude: number | null;
  timeMs: number | null;
  url: string | null;
}

export interface TensionData {
  zones: Record<string, ZoneScore>;
  global: number | null;
  history: Array<{ t: number; v: number }>;
  scored: number; // zones scored in the latest run
  total: number;
}

export interface RadioData {
  nowPlaying: { feedUrl: string; name: string } | null;
}

/* ---------------- slice plumbing ---------------- */

export type SourceStatus = 'idle' | 'loading' | 'live' | 'stale' | 'error';

export interface Slice<T> {
  status: SourceStatus;
  lastFetch: number | null; // epoch ms of last successful fetch
  lastAttempt: number | null;
  error: string | null;
  data: T;
  pollMs: number;
  records: number; // live record count for UI badges
}

export interface LiveState {
  tle: Slice<SatelliteTle[]>;
  aircraft: Slice<AircraftTrack[]>;
  ships: Slice<ShipTrack[]>;
  news: Slice<NewsItem[]>;
  eonet: Slice<NaturalEvent[]>;
  usgs: Slice<NaturalEvent[]>;
  tension: Slice<TensionData>;
  radio: Slice<RadioData>;
}

export type SourceKey = keyof LiveState;

function emptySlice<T>(data: T, pollMs: number): Slice<T> {
  return { status: 'idle', lastFetch: null, lastAttempt: null, error: null, data, pollMs, records: 0 };
}

const initialState: LiveState = {
  tle: emptySlice<SatelliteTle[]>([], CADENCE.tle),
  aircraft: emptySlice<AircraftTrack[]>([], CADENCE.aircraft),
  ships: emptySlice<ShipTrack[]>([], CADENCE.ships),
  news: emptySlice<NewsItem[]>([], CADENCE.gdelt),
  eonet: emptySlice<NaturalEvent[]>([], CADENCE.eonet),
  usgs: emptySlice<NaturalEvent[]>([], CADENCE.usgs),
  tension: emptySlice<TensionData>(
    { zones: {}, global: null, history: [], scored: 0, total: 0 },
    CADENCE.tension,
  ),
  radio: emptySlice<RadioData>({ nowPlaying: null }, 0),
};

let state: LiveState = initialState;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export const liveStore = {
  get(): LiveState {
    return state;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  /** Merge a partial update into one slice. */
  patch<K extends SourceKey>(key: K, partial: Partial<Slice<LiveState[K]['data']>>): void {
    state = { ...state, [key]: { ...state[key], ...partial } };
    emit();
  },
  /** Mark the start of a fetch attempt. */
  markLoading(key: SourceKey): void {
    const s = state[key];
    const status: SourceStatus = s.lastFetch ? s.status : 'loading';
    state = { ...state, [key]: { ...s, status, lastAttempt: Date.now(), error: null } };
    emit();
  },
  /** Record a successful fetch. */
  markLive<K extends SourceKey>(key: K, data: LiveState[K]['data'], records: number): void {
    state = {
      ...state,
      [key]: { ...state[key], status: 'live', lastFetch: Date.now(), lastAttempt: Date.now(), error: null, data, records },
    };
    emit();
  },
  /** Record a failed fetch (keeps last good data). */
  markError(key: SourceKey, message: string): void {
    const s = state[key];
    state = {
      ...state,
      [key]: { ...s, status: 'error', lastAttempt: Date.now(), error: message },
    };
    emit();
  },
};

/** Subscribe to the whole state (re-renders on any slice change). */
export function useLiveState(): LiveState {
  return useSyncExternalStore(liveStore.subscribe, liveStore.get, liveStore.get);
}

/** Subscribe to a single slice. */
export function useSlice<K extends SourceKey>(key: K): LiveState[K] {
  return useLiveState()[key];
}

/**
 * Derived display status: a live slice ages to STALE past 2× poll.
 * Call with Date.now() from a ticking component.
 */
export function derivedStatus(s: Pick<Slice<unknown>, 'status' | 'lastFetch' | 'pollMs'>, now: number): SourceStatus {
  if (s.status === 'error') return 'error';
  if (s.status === 'loading' || s.status === 'idle') return s.status;
  if (!s.lastFetch) return s.status;
  const age = now - s.lastFetch;
  if (s.pollMs > 0 && age > 2 * s.pollMs) return 'stale';
  return 'live';
}

/** Human age string: "4s", "3m", "1h". */
export function ageLabel(lastFetch: number | null, now: number): string {
  if (!lastFetch) return '—';
  const s = Math.max(0, Math.round((now - lastFetch) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

/* Layer visibility toggles (deck chrome) — readable from any page. */

export type LayerKey =
  | 'satellites'
  | 'aircraft'
  | 'ships'
  | 'conflictZones'
  | 'tensionHeat'
  | 'newsMarkers'
  | 'naturalEvents'
  | 'dayNight'
  | 'graticule';

export const LAYER_COLORS: Record<LayerKey, string> = {
  satellites: '#2EE6C8',
  aircraft: '#FFB020',
  ships: '#4EA8FF',
  conflictZones: '#FF3B47',
  tensionHeat: '#FF7A45',
  newsMarkers: '#D7E6EF',
  naturalEvents: '#9B8CFF',
  dayNight: '#5F7484',
  graticule: '#2EE6C8',
};

const layerDefaults: Record<LayerKey, boolean> = {
  satellites: true,
  aircraft: true,
  ships: true,
  conflictZones: true,
  tensionHeat: true,
  newsMarkers: true,
  naturalEvents: true,
  dayNight: false,
  graticule: true,
};

let layers: Record<LayerKey, boolean> = layerDefaults;

export const layerStore = {
  get(): Record<LayerKey, boolean> {
    return layers;
  },
  toggle(key: LayerKey): void {
    layers = { ...layers, [key]: !layers[key] };
    emit();
  },
  set(key: LayerKey, v: boolean): void {
    layers = { ...layers, [key]: v };
    emit();
  },
};

export function useLayers(): Record<LayerKey, boolean> {
  useSyncExternalStore(liveStore.subscribe, liveStore.get, liveStore.get);
  return layerStore.get();
}
