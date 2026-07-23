/**
 * Sources-page instrumentation — real, client-side only:
 *
 * 1. LATENCY probes: while the Sources page is open, each polled source
 *    is re-requested from this browser (sequentially, gently staggered)
 *    and the round-trip time is recorded. The GDELT probe goes through
 *    the real global queue, so its latency honestly includes queue wait.
 *
 * 2. FAILURES 24H: a module-level subscription to the live store counts
 *    every real slice transition into ERROR, persisted to localStorage
 *    and counted over a rolling 24h window ("this browser" — labeled).
 *
 * No synthetic values: unmeasured vitals render as ——.
 */

import { useSyncExternalStore } from 'react';
import { ENDPOINTS, fetchViaProxyChain, gdeltDocUrl, gdeltFetch } from '@/lib/sources';
import type { GdeltArtlistResponse } from '@/lib/sources';
import { liveStore } from '@/store/useLiveStore';
import type { SourceStatus } from '@/store/useLiveStore';

export type ProbeKey = 'tle' | 'aircraft' | 'ships' | 'news' | 'eonet' | 'usgs';

export interface ProbeResult {
  latencyMs: number | null;
  at: number | null;
  via: string | null; // proxy hop used (adsb.lol) or 'queue' (GDELT)
}

type ProbeState = Record<ProbeKey, ProbeResult>;

const empty: ProbeResult = { latencyMs: null, at: null, via: null };

let probeState: ProbeState = {
  tle: { ...empty },
  aircraft: { ...empty },
  ships: { ...empty },
  news: { ...empty },
  eonet: { ...empty },
  usgs: { ...empty },
};

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}

function setProbe(key: ProbeKey, r: ProbeResult) {
  probeState = { ...probeState, [key]: r };
  emit();
}

export function useProbes(): ProbeState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => probeState,
    () => probeState,
  );
}

/* ------------------------------------------------------------------ */
/* Individual probes — each times a real request from this browser     */
/* ------------------------------------------------------------------ */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const t0 = performance.now();
  const value = await fn();
  return { ms: Math.round(performance.now() - t0), value };
}

const PROBES: Array<{ key: ProbeKey; run: () => Promise<void> }> = [
  {
    key: 'tle',
    run: async () => {
      const { ms } = await timed(async () => {
        const res = await fetch(ENDPOINTS.celestrak('stations'), { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await res.text();
      });
      setProbe('tle', { latencyMs: ms, at: Date.now(), via: 'direct' });
    },
  },
  {
    key: 'aircraft',
    run: async () => {
      // one real hotspot point query through the full proxy chain
      const { ms, value } = await timed(() => fetchViaProxyChain(ENDPOINTS.adsb(48.6, 37.0, 250), undefined, 12_000));
      await value.response.json().catch(() => undefined);
      setProbe('aircraft', { latencyMs: ms, at: Date.now(), via: value.via });
    },
  },
  {
    key: 'ships',
    run: async () => {
      const { ms } = await timed(async () => {
        const res = await fetch(ENDPOINTS.digitrafficAis, { signal: AbortSignal.timeout(12_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await res.json();
      });
      setProbe('ships', { latencyMs: ms, at: Date.now(), via: 'direct' });
    },
  },
  {
    key: 'news',
    run: async () => {
      // through the REAL global queue — latency honestly includes queue wait
      const { ms } = await timed(() =>
        gdeltFetch<GdeltArtlistResponse>(
          gdeltDocUrl({ query: '(ukraine OR gaza OR sudan)', mode: 'artlist', maxrecords: 1, timespan: '24h' }),
        ),
      );
      setProbe('news', { latencyMs: ms, at: Date.now(), via: 'queue' });
    },
  },
  {
    key: 'eonet',
    run: async () => {
      const { ms } = await timed(async () => {
        const res = await fetch(ENDPOINTS.eonet, { signal: AbortSignal.timeout(12_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await res.json();
      });
      setProbe('eonet', { latencyMs: ms, at: Date.now(), via: 'direct' });
    },
  },
  {
    key: 'usgs',
    run: async () => {
      const { ms } = await timed(async () => {
        const res = await fetch(ENDPOINTS.usgs, { signal: AbortSignal.timeout(12_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await res.json();
      });
      setProbe('usgs', { latencyMs: ms, at: Date.now(), via: 'direct' });
    },
  },
];

/* ------------------------------------------------------------------ */
/* Probe scheduler — refcounted, sequential, 120s cadence              */
/* ------------------------------------------------------------------ */

let refs = 0;
let intervalId = 0;
let running = false;

async function runAll() {
  if (running) return;
  running = true;
  for (const p of PROBES) {
    try {
      await p.run();
    } catch {
      /* probe failed — the slice status carries the real error state */
    }
    await sleep(1_500); // gentle: one probe at a time
  }
  running = false;
}

/** Call from the Sources page; returns a stop function. Idempotent. */
export function startProbes(): () => void {
  refs++;
  if (refs === 1) {
    void runAll();
    intervalId = window.setInterval(() => void runAll(), 120_000);
  }
  return () => {
    refs = Math.max(0, refs - 1);
    if (refs === 0 && intervalId) {
      window.clearInterval(intervalId);
      intervalId = 0;
    }
  };
}

/* ------------------------------------------------------------------ */
/* FAILURES 24H — real client-side error transition counter            */
/* ------------------------------------------------------------------ */

const FAIL_KEY = 'wf-failures-v1';
const DAY = 24 * 60 * 60_000;

interface FailureEvent {
  k: string;
  t: number;
}

function readFailures(): FailureEvent[] {
  try {
    const raw = localStorage.getItem(FAIL_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as FailureEvent[];
    const cutoff = Date.now() - DAY;
    return Array.isArray(arr) ? arr.filter((f) => typeof f?.t === 'number' && f.t > cutoff) : [];
  } catch {
    return [];
  }
}

let failureCount = readFailures().length;
let failInit = false;

/** Module-level store subscription: count transitions into ERROR. */
export function initFailureCounter(): void {
  if (failInit) return;
  failInit = true;
  let prev: Partial<Record<string, SourceStatus>> = {};
  liveStore.subscribe(() => {
    const s = liveStore.get();
    (Object.keys(s) as Array<keyof typeof s>).forEach((k) => {
      const status = s[k].status;
      if (status === 'error' && prev[k] !== 'error') {
        const events = readFailures();
        events.push({ k, t: Date.now() });
        try {
          localStorage.setItem(FAIL_KEY, JSON.stringify(events.slice(-200)));
        } catch {
          /* storage blocked — counter is best-effort */
        }
        failureCount = events.length;
        emit();
      }
      prev[k] = status;
    });
  });
}

/** Rolling 24h failure count for one source key (this browser). */
export function failures24h(key: string): number {
  void failureCount; // re-read on probe-store emissions
  return readFailures().filter((f) => f.k === key).length;
}
