/**
 * Intel wire — topic presets, the page-local GDELT artlist feed hook,
 * and shared display utils. Every request goes through the global GDELT
 * queue (6s spacing, 15-min cache) from src/lib/sources.ts.
 *
 * NO MOCK DATA: GDELT DOC 2.0 artlist has no per-article tone field
 * (verified against the live API), so tone shown on cards is the real
 * query-level timelinetone (7d) latest value, labeled as such.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CADENCE, gdeltDocUrl, gdeltFetch } from '@/lib/sources';
import type { GdeltArtlistResponse, GdeltArticle, GdeltTimelineResponse } from '@/lib/sources';
import { countryCentroid } from '@/lib/countries';

/* ------------------------------------------------------------------ */
/* Topic presets — each chip is a real GDELT DOC 2.0 query             */
/* ------------------------------------------------------------------ */

export interface TopicPreset {
  id: string;
  label: string;
  query: string;
}

export const TOPIC_PRESETS: TopicPreset[] = [
  { id: 'conflict', label: 'CONFLICT', query: '(airstrike OR offensive OR missile OR frontline OR clash OR escalation)' },
  { id: 'military', label: 'MILITARY', query: '(military OR troops OR "armed forces") (deployment OR exercise OR mobilization)' },
  { id: 'ceasefire', label: 'CEASEFIRE', query: '(ceasefire OR truce OR "peace talks" OR armistice)' },
  { id: 'sanctions', label: 'SANCTIONS', query: '(sanctions OR embargo OR "export controls") (imposed OR expanded OR evasion)' },
  { id: 'cyber', label: 'CYBER ATTACK', query: '("cyber attack" OR cyberattack OR ransomware) (government OR infrastructure OR military)' },
  { id: 'protests', label: 'PROTESTS', query: '(protests OR demonstrations OR unrest) (police OR crackdown OR clashes)' },
  { id: 'nuclear', label: 'NUCLEAR', query: '(nuclear OR uranium OR iaea OR warhead) (enrichment OR test OR program OR threat)' },
  { id: 'humanitarian', label: 'HUMANITARIAN', query: '(humanitarian OR refugees OR famine OR "aid convoy") (crisis OR civilians OR displaced)' },
];

export type WireSort = 'hybridrel' | 'datedesc';
const LIMIT_STEP = 50;
const LIMIT_MAX = 250; // GDELT artlist hard cap

/* ------------------------------------------------------------------ */
/* Display utils                                                       */
/* ------------------------------------------------------------------ */

/** GDELT seendate "20260722T213000Z" → epoch ms. */
export function parseSeenDate(s: string): number | null {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** Relative age label: "42S AGO" / "12M AGO" / "3H AGO" / "2D AGO". */
export function relLabel(ms: number | null, now: number): string {
  if (ms == null) return '——';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}S AGO`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}M AGO`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}H AGO`;
  return `${Math.floor(h / 24)}D AGO`;
}

/** UTC "HH:MM" for event rows. */
export function utcHM(ms: number | null): string {
  if (ms == null) return '——';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** UTC "YYYY-MM-DD" short date. */
export function utcDate(ms: number | null): string {
  if (ms == null) return '——';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** Tone bar color: green ≥+2, dim −2..+2, amber −5..−2, red ≤−5. */
export function toneColor(t: number | null): string {
  if (t == null) return 'var(--ink-faint)';
  if (t >= 2) return '#3DF58A';
  if (t > -2) return '#5F7484';
  if (t > -5) return '#FFB020';
  return '#FF3B47';
}

/** djb2 hex hash — stable per-URL id for deck pin links. */
export function urlHash(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/* Country name → 2-letter chip. Static reference data for the most
 * common GDELT source countries; fallback = first 2 letters. */
const COUNTRY_CODES: Record<string, string> = {
  'united states': 'US', 'united kingdom': 'GB', 'ukraine': 'UA', 'russia': 'RU',
  'russian federation': 'RU', 'china': 'CN', 'taiwan': 'TW', 'iran': 'IR', 'israel': 'IL',
  'palestine': 'PS', 'palestinian territory': 'PS', 'syria': 'SY', 'lebanon': 'LB', 'iraq': 'IQ',
  'yemen': 'YE', 'saudi arabia': 'SA', 'turkey': 'TR', 'turkiye': 'TR', 'germany': 'DE',
  'france': 'FR', 'italy': 'IT', 'spain': 'ES', 'poland': 'PL', 'netherlands': 'NL',
  'belgium': 'BE', 'sweden': 'SE', 'norway': 'NO', 'finland': 'FI', 'denmark': 'DK',
  'japan': 'JP', 'south korea': 'KR', 'korea': 'KR', 'north korea': 'KP', 'india': 'IN',
  'pakistan': 'PK', 'afghanistan': 'AF', 'australia': 'AU', 'canada': 'CA', 'mexico': 'MX',
  'brazil': 'BR', 'argentina': 'AR', 'colombia': 'CO', 'venezuela': 'VE', 'chile': 'CL',
  'peru': 'PE', 'egypt': 'EG', 'libya': 'LY', 'sudan': 'SD', 'south sudan': 'SS',
  'somalia': 'SO', 'ethiopia': 'ET', 'nigeria': 'NG', 'niger': 'NE', 'mali': 'ML',
  'burkina faso': 'BF', 'kenya': 'KE', 'south africa': 'ZA', 'congo': 'CD',
  'democratic republic of the congo': 'CD', 'myanmar': 'MM', 'thailand': 'TH', 'vietnam': 'VN',
  'philippines': 'PH', 'indonesia': 'ID', 'malaysia': 'MY', 'singapore': 'SG', 'armenia': 'AM',
  'azerbaijan': 'AZ', 'georgia': 'GE', 'belarus': 'BY', 'romania': 'RO', 'greece': 'GR',
  'hungary': 'HU', 'czech republic': 'CZ', 'czechia': 'CZ', 'austria': 'AT', 'switzerland': 'CH',
  'ireland': 'IE', 'portugal': 'PT', 'qatar': 'QA', 'united arab emirates': 'AE', 'kuwait': 'KW',
  'jordan': 'JO', 'bahrain': 'BH', 'oman': 'OM', 'kazakhstan': 'KZ', 'uzbekistan': 'UZ',
  'haiti': 'HT', 'cuba': 'CU', 'bangladesh': 'BD', 'sri lanka': 'LK', 'nepal': 'NP',
  'new zealand': 'NZ', 'serbia': 'RS', 'croatia': 'HR', 'albania': 'AL', 'kosovo': 'XK',
  'morocco': 'MA', 'algeria': 'DZ', 'tunisia': 'TN', 'ghana': 'GH', 'cameroon': 'CM',
  'chad': 'TD', 'mozambique': 'MZ', 'zimbabwe': 'ZW', 'uganda': 'UG', 'rwanda': 'RW',
  'ecuador': 'EC', 'bolivia': 'BO', 'paraguay': 'PY', 'uruguay': 'UY', 'guatemala': 'GT',
  'honduras': 'HN', 'el salvador': 'SV', 'nicaragua': 'NI', 'panama': 'PA', 'mongolia': 'MN',
  'kyrgyzstan': 'KG', 'tajikistan': 'TJ', 'turkmenistan': 'TM', 'laos': 'LA', 'cambodia': 'KH',
  'estonia': 'EE', 'latvia': 'LV', 'lithuania': 'LT', 'slovakia': 'SK', 'slovenia': 'SI',
  'bulgaria': 'BG', 'moldova': 'MD', 'iceland': 'IS', 'luxembourg': 'LU', 'malta': 'MT',
  'cyprus': 'CY', 'ivory coast': 'CI', "cote d'ivoire": 'CI', 'senegal': 'SN', 'guinea': 'GN',
};

export function countryCode(name: string): string {
  const key = name.trim().toLowerCase();
  const mapped = COUNTRY_CODES[key];
  if (mapped) return mapped;
  const clean = name.replace(/[^a-zA-Z]/g, '');
  return clean.length >= 2 ? clean.slice(0, 2).toUpperCase() : 'INT';
}

/* ------------------------------------------------------------------ */
/* Ticking clock hook                                                  */
/* ------------------------------------------------------------------ */

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

/* ------------------------------------------------------------------ */
/* Wire feed hook                                                      */
/* ------------------------------------------------------------------ */

export interface WireArticle extends GdeltArticle {
  seenMs: number | null;
  code: string;
  hasGeo: boolean;
  hash: string;
}

export type WireStatus = 'idle' | 'loading' | 'live' | 'error';

export interface WireState {
  articles: WireArticle[];
  status: WireStatus;
  error: string | null;
  lastFetch: number | null;
  tone: number | null;
  limit: number;
  endOfWindow: boolean;
  queueBusy: boolean;
  fresh: Set<string>;
}

function toWire(a: GdeltArticle): WireArticle {
  return {
    ...a,
    seenMs: parseSeenDate(a.seendate),
    code: countryCode(a.sourcecountry || ''),
    hasGeo: !!countryCentroid(a.sourcecountry),
    hash: urlHash(a.url),
  };
}

export function useWireFeed() {
  const [active, setActive] = useState<TopicPreset>(TOPIC_PRESETS[0]);
  const [sort, setSortState] = useState<WireSort>('hybridrel');
  const [state, setState] = useState<WireState>({
    articles: [],
    status: 'idle',
    error: null,
    lastFetch: null,
    tone: null,
    limit: LIMIT_STEP,
    endOfWindow: false,
    queueBusy: false,
    fresh: new Set(),
  });
  const reqRef = useRef(0);
  const prevUrlsRef = useRef<Set<string>>(new Set());
  const flashTimer = useRef<number>(0);

  const load = useCallback(async (query: string, order: WireSort, limit: number, extend: boolean) => {
    const req = ++reqRef.current;
    setState((s) => ({
      ...s,
      queueBusy: true,
      status: s.lastFetch ? s.status : 'loading',
      error: null,
    }));
    const url = `${gdeltDocUrl({ query, mode: 'artlist', maxrecords: limit, timespan: '24h' })}&sort=${order}`;
    try {
      const res = await gdeltFetch<GdeltArtlistResponse>(url);
      if (req !== reqRef.current) return;
      const seen = new Set<string>();
      const articles = (res.articles ?? []).map(toWire).filter((a) => {
        if (seen.has(a.url)) return false;
        seen.add(a.url);
        return true;
      });
      const prev = prevUrlsRef.current;
      const fresh =
        extend || prev.size > 0
          ? new Set(articles.filter((a) => !prev.has(a.url)).map((a) => a.url))
          : new Set<string>();
      const noGrowth = extend && articles.length <= prev.size;
      prevUrlsRef.current = seen;
      window.clearTimeout(flashTimer.current);
      if (fresh.size > 0) {
        flashTimer.current = window.setTimeout(() => {
          setState((s) => ({ ...s, fresh: new Set() }));
        }, 900);
      }
      setState((s) => ({
        ...s,
        articles,
        status: 'live',
        lastFetch: Date.now(),
        limit,
        queueBusy: false,
        fresh,
        endOfWindow: noGrowth || (limit >= LIMIT_MAX && articles.length < limit),
      }));
    } catch (err) {
      if (req !== reqRef.current) return;
      setState((s) => ({
        ...s,
        queueBusy: false,
        status: 'error',
        error: err instanceof Error ? err.message : 'GDELT fetch failed',
      }));
    }
  }, []);

  /* Query-level tone (real GDELT timelinetone, 7d) — one queued request. */
  const loadTone = useCallback(async (query: string) => {
    const req = reqRef.current;
    try {
      const url = gdeltDocUrl({ query, mode: 'timelinetone', timespan: '7d' });
      const res = await gdeltFetch<GdeltTimelineResponse>(url);
      if (req !== reqRef.current) return;
      const series = res.timeline?.[0]?.data ?? [];
      const latest = series.length ? series[series.length - 1].value : null;
      setState((s) => ({ ...s, tone: typeof latest === 'number' ? Math.round(latest * 100) / 100 : null }));
    } catch {
      /* tone readout is best-effort; absence is shown as —— */
    }
  }, []);

  /* initial + on query/sort change */
  useEffect(() => {
    prevUrlsRef.current = new Set();
    setState((s) => ({ ...s, tone: null, endOfWindow: false, limit: LIMIT_STEP }));
    void load(active.query, sort, LIMIT_STEP, false);
    void loadTone(active.query);
  }, [active, sort, load, loadTone]);

  /* 15-min refresh aligned with the GDELT cache window */
  const limitRef = useRef(LIMIT_STEP);
  useEffect(() => {
    limitRef.current = state.limit;
  }, [state.limit]);
  useEffect(() => {
    const t = window.setInterval(() => {
      void load(active.query, sort, limitRef.current, false);
      void loadTone(active.query);
    }, CADENCE.gdelt);
    return () => window.clearInterval(t);
  }, [active, sort, load, loadTone]);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const setPreset = useCallback((p: TopicPreset) => setActive(p), []);
  const search = useCallback((text: string) => {
    const q = text.trim().slice(0, 200);
    if (!q) return;
    setActive({ id: 'search', label: q.toUpperCase(), query: q });
  }, []);
  const setSort = useCallback((s: WireSort) => setSortState(s), []);
  const loadMore = useCallback(() => {
    if (state.queueBusy || state.endOfWindow) return;
    const next = Math.min(state.limit + LIMIT_STEP, LIMIT_MAX);
    if (next === state.limit) {
      setState((s) => ({ ...s, endOfWindow: true }));
      return;
    }
    void load(active.query, sort, next, true);
  }, [state.queueBusy, state.endOfWindow, state.limit, active, sort, load]);

  return { state, active, sort, setPreset, search, setSort, loadMore };
}
