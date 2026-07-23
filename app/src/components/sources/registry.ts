/**
 * Source registry data — the eight source families rendered as
 * SourceCards. Endpoint strings and cadences mirror src/lib/sources.ts
 * (the values the poller actually uses); notes are the honest quirks.
 */

import { derivedStatus } from '@/store/useLiveStore';
import type { LiveState, SourceKey } from '@/store/useLiveStore';
import { ENDPOINTS } from '@/lib/sources';
import type { ProbeKey } from './probes';

export interface RegistryEntry {
  id: string;
  key: SourceKey | null; // store slice driving live status (null = external links only)
  probe: ProbeKey | null; // latency probe key (null = not probed)
  name: string;
  role: string;
  endpoint: string;
  cadence: string;
  notes: string;
}

export const REGISTRY: RegistryEntry[] = [
  {
    id: 'celestrak',
    key: 'tle',
    probe: 'tle',
    name: 'CelesTrak TLE',
    role: 'ORBITAL ELEMENTS',
    endpoint: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=…&FORMAT=tle',
    cadence: 'POLL 30M',
    notes:
      'CORS open. TLE epochs shown per object; propagated client-side via satellite.js SGP4 at 1–2Hz; rendered cap ~1500 points.',
  },
  {
    id: 'adsblol',
    key: 'aircraft',
    probe: 'aircraft',
    name: 'adsb.lol ADS-B',
    role: 'AIRCRAFT TRACKS',
    endpoint: 'https://api.adsb.lol/v2/lat/…/lon/…/dist/…',
    cadence: 'POLL 10–15S',
    notes:
      'No CORS header → proxy chain tried in order: direct → corsproxy.io → allorigins → isomorphic-git; per-route status shown on Tracking page; ~250nm radius per call, hotspot grid, de-dup by ICAO24.',
  },
  {
    id: 'digitraffic',
    key: 'ships',
    probe: 'ships',
    name: 'Digitraffic AIS',
    role: 'VESSEL AIS',
    endpoint: ENDPOINTS.digitrafficAis,
    cadence: 'POLL 30S',
    notes:
      'CORS open. Real Finnish Transport Infrastructure Agency feed. Baltic/Finnish coverage stated plainly; global AIS optional via user’s own aisstream.io key.',
  },
  {
    id: 'gdelt',
    key: 'news',
    probe: 'news',
    name: 'GDELT DOC 2.0',
    role: 'NEWS & TONE',
    endpoint: ENDPOINTS.gdeltDoc,
    cadence: '15M CACHE · 6S QUEUE',
    notes:
      'CORS open. 15-min update cycle; strict 1 req/5s limit handled by a global 6s queue; artlist / timelinevol / timelinetone modes; GEO API decommissioned (noted).',
  },
  {
    id: 'eonet',
    key: 'eonet',
    probe: 'eonet',
    name: 'NASA EONET',
    role: 'NATURAL EVENTS',
    endpoint: ENDPOINTS.eonet,
    cadence: 'POLL 10M',
    notes: 'Open events, CORS open, 10-min poll.',
  },
  {
    id: 'usgs',
    key: 'usgs',
    probe: 'usgs',
    name: 'USGS',
    role: 'SEISMIC',
    endpoint: ENDPOINTS.usgs,
    cadence: 'POLL 5M',
    notes: 'M2.5+ 24h GeoJSON, CORS open, 5-min poll.',
  },
  {
    id: 'liveatc',
    key: 'radio',
    probe: null,
    name: 'LiveATC',
    role: 'RADIO CHATTER',
    endpoint: 'https://d.liveatc.net/{feed} (302 → https stream)',
    cadence: 'ON PLAY',
    notes: '302 → https stream in HTMLAudioElement; volunteer-hosted; per-feed error states.',
  },
  {
    id: 'websdr',
    key: null,
    probe: null,
    name: 'WebSDR / KiwiSDR / Broadcastify',
    role: 'EXTERNAL RECEIVERS',
    endpoint: 'websdr.org · kiwisdr.com · broadcastify.com (tuned links)',
    cadence: 'EXTERNAL',
    notes: 'External tuned links only; public receivers; no inline embedding of third-party players.',
  },
];

/**
 * Aggregate health: sources counted live. Polled slices must be LIVE
 * per the status model; LiveATC is on-demand (counts unless ERROR);
 * external link cards have nothing to fail.
 */
export function registryLiveCount(state: LiveState, now: number): number {
  let live = 0;
  for (const r of REGISTRY) {
    if (!r.key) {
      live++; // external links — no fetch, nothing to fail
      continue;
    }
    const slice = state[r.key];
    if (r.id === 'liveatc') {
      if (slice.status !== 'error') live++;
      continue;
    }
    if (derivedStatus(slice, now) === 'live') live++;
  }
  return live;
}
