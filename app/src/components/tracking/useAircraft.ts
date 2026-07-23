import { useEffect, useRef, useState, useCallback } from 'react'
import { fetchViaChain, PROXY_ROUTES } from './net'
import type { RouteStatus } from './net'
import type { FeedStatus } from './hud'

/** adsb.lol v2 circle queries over a global hotspot grid (receiver coverage, labeled honestly) */
export interface AcRegion {
  name: string
  lat: number
  lon: number
}

export const AC_REGIONS: AcRegion[] = [
  { name: 'NE-AMERICA', lat: 40.7, lon: -74.0 },
  { name: 'W-AMERICA', lat: 37.6, lon: -122.3 },
  { name: 'C-AMERICA', lat: 39.8, lon: -98.5 },
  { name: 'S-AMERICA', lat: -14.2, lon: -56.0 },
  { name: 'W-EUROPE', lat: 50.1, lon: 8.7 },
  { name: 'BALTIC', lat: 58.5, lon: 21.0 },
  { name: 'BLACK-SEA', lat: 46.5, lon: 31.0 },
  { name: 'MEDITERRANEAN', lat: 36.5, lon: 15.0 },
  { name: 'GULF', lat: 26.5, lon: 52.5 },
  { name: 'S-ASIA', lat: 22.5, lon: 78.0 },
  { name: 'E-ASIA', lat: 34.5, lon: 114.0 },
  { name: 'SE-ASIA', lat: 4.0, lon: 104.0 },
  { name: 'JAPAN', lat: 36.0, lon: 139.5 },
  { name: 'OCEANIA', lat: -33.5, lon: 151.0 },
]

const REGION_DIST_NM = 250
const BASE_GAP_MS = 1300 // spacing between region requests
const BACKOFF_STEPS_MS = [10000, 15000, 30000] // rate-limit auto-backoff per design
const PRUNE_AFTER_S = 600
const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700'])

export interface AcRow {
  hex: string
  callsign: string
  type: string
  category: string
  altFt: number | null
  onGround: boolean
  gsKt: number | null
  trackDeg: number | null
  squawk: string | null
  lat: number | null
  lon: number | null
  seenSec: number
  emergency: boolean
  region: string
  lastSeenMs: number
}

interface AdsbAc {
  hex?: string
  flight?: string
  t?: string
  category?: string
  alt_baro?: number | 'ground' | null
  gs?: number
  track?: number
  squawk?: string
  lat?: number
  lon?: number
  seen?: number
}

interface AdsbResponse {
  ac?: AdsbAc[]
  now?: number
}

export type AcFilter = 'all' | 'mil' | 'heli' | 'heavy' | 'squawk'

// Heuristic type-designator sets (labeled HEURISTIC in UI)
const MIL_TYPES = new Set([
  'F16', 'F15', 'F18', 'F22', 'F35', 'F4', 'F5', 'F14', 'F111', 'A10', 'B52', 'B1', 'B2', 'B21',
  'C17', 'C5', 'C130', 'C30J', 'C2', 'KC10', 'K35R', 'KC46', 'K35E', 'E3', 'E3TF', 'E6', 'E8',
  'P8', 'P3', 'R135', 'RC35', 'U2', 'MQ9', 'MQ1', 'MQ4', 'RQ4', 'V22', 'H60', 'T38', 'T6', 'T45',
  'EUFI', 'TYPH', 'RFAL', 'MRTT', 'A400', 'K35A', 'C135', 'E11A', 'GLF5', 'SU27', 'SU34', 'MIG29',
])
const HELI_RE = /^(H|UH|AH|CH|MH|SH|TH|R22|R44|R66|B06|B407|B429|B212|B412|AS32|AS35|AS50|AS55|EC20|EC25|EC30|EC35|EC45|EC55|S70|S76|S92|AW09|AW39|AW69|A109|A139|A169|A189|BK17|MD52|MD60|KA32|MI8|MI24|H125|H130|H145|H155|H160)/
const HEAVY_TYPES = new Set(['A124', 'A225', 'A388', 'B748', 'B744', 'B74S', 'B74R', 'C5', 'C5M', 'C17'])

export function classifyAc(row: AcRow): { mil: boolean; heli: boolean; heavy: boolean } {
  const t = (row.type || '').toUpperCase()
  const mil = MIL_TYPES.has(t)
  const heli = HELI_RE.test(t)
  const heavy = HEAVY_TYPES.has(t) || row.category === 'A5' || row.category === 'A6' || row.category === 'A7'
  return { mil, heli, heavy }
}

export interface AircraftFeed {
  status: FeedStatus
  rows: AcRow[]
  count: number
  emergencies: AcRow[]
  avgAltFt: number | null
  avgGsKt: number | null
  regionsPolled: number
  lastPollMs: number | null
  nextPollInSec: number
  backoffLevel: number
  error: string | null
  route: string | null
  routeStatuses: RouteStatus[]
  allRoutesFailed: boolean
  filter: AcFilter
  setFilter: (f: AcFilter) => void
  query: string
  setQuery: (q: string) => void
  filteredRows: AcRow[]
}

export function useAircraft(now: number): AircraftFeed {
  const [acMap, setAcMap] = useState<Map<string, AcRow>>(new Map())
  const [status, setStatus] = useState<FeedStatus>('idle')
  const [lastPollMs, setLastPollMs] = useState<number | null>(null)
  const [nextPollAt, setNextPollAt] = useState<number>(0)
  const [backoffLevel, setBackoffLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [route, setRoute] = useState<string | null>(null)
  const [routeStatuses, setRouteStatuses] = useState<RouteStatus[]>(PROXY_ROUTES.map(() => 'untested'))
  const [allRoutesFailed, setAllRoutesFailed] = useState(false)
  const [regionsPolled, setRegionsPolled] = useState(0)
  const [filter, setFilter] = useState<AcFilter>('all')
  const [query, setQuery] = useState('')

  const regionIdxRef = useRef(0)
  const preferredRouteRef = useRef(0)
  const consecFailRef = useRef(0)
  const polledThisCycleRef = useRef(0)
  const stoppedRef = useRef(false)

  const pollRegion = useCallback(async () => {
    const region = AC_REGIONS[regionIdxRef.current % AC_REGIONS.length]
    regionIdxRef.current += 1
    if (regionIdxRef.current % AC_REGIONS.length === 1 && regionIdxRef.current > 1) {
      setRegionsPolled(polledThisCycleRef.current)
      polledThisCycleRef.current = 0
    }
    const url = `https://api.adsb.lol/v2/lat/${region.lat}/lon/${region.lon}/dist/${REGION_DIST_NM}`
    try {
      const { res, routeIndex, routeStatuses: rs } = await fetchViaChain(url, {
        timeoutMs: 12000,
        preferredRoute: preferredRouteRef.current,
      })
      preferredRouteRef.current = routeIndex
      setRouteStatuses((prev) => prev.map((p, i) => (rs[i] !== 'untested' ? rs[i] : p)))
      setRoute(PROXY_ROUTES[routeIndex]?.label ?? null)
      const data = (await res.json()) as AdsbResponse
      const nowMs = Date.now()
      const batch = new Map<string, AcRow>()
      for (const a of data.ac ?? []) {
        if (!a.hex) continue
        const squawk = a.squawk ?? null
        batch.set(a.hex, {
          hex: a.hex,
          callsign: (a.flight ?? '').trim(),
          type: a.t ?? '',
          category: a.category ?? '',
          altFt: typeof a.alt_baro === 'number' ? a.alt_baro : null,
          onGround: a.alt_baro === 'ground',
          gsKt: typeof a.gs === 'number' ? a.gs : null,
          trackDeg: typeof a.track === 'number' ? a.track : null,
          squawk,
          lat: typeof a.lat === 'number' ? a.lat : null,
          lon: typeof a.lon === 'number' ? a.lon : null,
          seenSec: typeof a.seen === 'number' ? a.seen : 0,
          emergency: squawk != null && EMERGENCY_SQUAWKS.has(squawk),
          region: region.name,
          lastSeenMs: nowMs,
        })
      }
      setAcMap((prev) => {
        const next = new Map(prev)
        for (const [k, v] of batch) next.set(k, v)
        // prune long-unseen targets
        for (const [k, v] of next) {
          if (nowMs - v.lastSeenMs > PRUNE_AFTER_S * 1000 && v.seenSec > PRUNE_AFTER_S) next.delete(k)
        }
        return next
      })
      polledThisCycleRef.current += 1
      setRegionsPolled((p) => Math.max(p, polledThisCycleRef.current))
      consecFailRef.current = 0
      setBackoffLevel(0)
      setAllRoutesFailed(false)
      setError(null)
      setStatus('live')
      setLastPollMs(nowMs)
      return BASE_GAP_MS
    } catch (e) {
      const rs = (e as { routeStatuses?: RouteStatus[] }).routeStatuses
      if (rs) setRouteStatuses(rs)
      consecFailRef.current += 1
      const lvl = Math.min(consecFailRef.current - 1, BACKOFF_STEPS_MS.length - 1)
      setBackoffLevel(consecFailRef.current)
      setError(e instanceof Error ? e.message : 'poll failed')
      if (consecFailRef.current >= 3) {
        setAllRoutesFailed(true)
        setStatus((s) => (s === 'live' ? 'stale' : 'error'))
      }
      return BACKOFF_STEPS_MS[Math.max(0, lvl)]
    }
  }, [])

  // Scheduler: sequential region polls with adaptive delay + countdown
  useEffect(() => {
    stoppedRef.current = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      if (stoppedRef.current) return
      const delay = await pollRegion()
      if (stoppedRef.current) return
      setNextPollAt(Date.now() + delay)
      timer = setTimeout(() => void tick(), delay)
    }
    void tick()
    return () => {
      stoppedRef.current = true
      clearTimeout(timer)
    }
  }, [pollRegion])

  const rows = Array.from(acMap.values()).filter((r) => r.lat != null && r.lon != null)
  const positioned = rows

  let altSum = 0
  let altN = 0
  let gsSum = 0
  let gsN = 0
  for (const r of positioned) {
    if (r.altFt != null) {
      altSum += r.altFt
      altN += 1
    }
    if (r.gsKt != null) {
      gsSum += r.gsKt
      gsN += 1
    }
  }

  const q = query.trim().toUpperCase()
  const filteredRows = positioned.filter((r) => {
    if (q && !r.callsign.toUpperCase().includes(q) && !r.hex.toUpperCase().includes(q)) return false
    if (filter === 'squawk') return r.emergency
    if (filter === 'all') return true
    const cls = classifyAc(r)
    if (filter === 'mil') return cls.mil
    if (filter === 'heli') return cls.heli
    if (filter === 'heavy') return cls.heavy
    return true
  })

  return {
    status,
    rows: positioned,
    count: positioned.length,
    emergencies: positioned.filter((r) => r.emergency),
    avgAltFt: altN ? Math.round(altSum / altN) : null,
    avgGsKt: gsN ? Math.round(gsSum / gsN) : null,
    regionsPolled,
    lastPollMs,
    nextPollInSec: Math.max(0, Math.ceil((nextPollAt - now) / 1000)),
    backoffLevel,
    error,
    route,
    routeStatuses,
    allRoutesFailed,
    filter,
    setFilter,
    query,
    setQuery,
    filteredRows,
  }
}
