import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { twoline2satrec, propagate, gstime, eciToGeodetic, degreesLat, degreesLong } from 'satellite.js'
import type { SatRec } from 'satellite.js'
import { fetchViaChain, PROXY_ROUTES } from './net'
import type { RouteStatus } from './net'
import { C } from './hud'
import type { FeedStatus } from './hud'

export interface SatGroupDef {
  id: string
  label: string
  celestrakGroup: string
  category: string
  color: string
}

export const SAT_GROUPS: SatGroupDef[] = [
  { id: 'stations', label: 'STATIONS', celestrakGroup: 'stations', category: 'CREWED STATIONS', color: C.cyan },
  { id: 'brightest', label: 'BRIGHTEST', celestrakGroup: 'visual', category: 'VISUALLY BRIGHT', color: C.ink },
  { id: 'gps', label: 'GPS', celestrakGroup: 'gps-ops', category: 'NAV CONSTELLATION', color: C.blue },
  { id: 'glonass', label: 'GLONASS', celestrakGroup: 'glo-ops', category: 'NAV CONSTELLATION', color: C.blue },
  { id: 'galileo', label: 'GALILEO', celestrakGroup: 'galileo', category: 'NAV CONSTELLATION', color: C.blue },
  { id: 'beidou', label: 'BEIDOU', celestrakGroup: 'beidou', category: 'NAV CONSTELLATION', color: C.blue },
  { id: 'noaa', label: 'NOAA', celestrakGroup: 'weather', category: 'WEATHER', color: C.violet },
  { id: 'iridium', label: 'IRIDIUM', celestrakGroup: 'iridium-NEXT', category: 'COMMS CONSTELLATION', color: C.amber },
  { id: 'starlink', label: 'STARLINK', celestrakGroup: 'starlink', category: 'COMMS CONSTELLATION', color: C.amber },
  { id: 'new30d', label: 'NEW-30D', celestrakGroup: 'last-30-days', category: 'RECENT LAUNCHES', color: C.orange },
]

const TLE_REFRESH_MS = 30 * 60 * 1000 // 30 min cadence per design
const MU = 398600.4418 // km^3/s^2
const RE = 6371.0 // km mean Earth radius
const JD_UNIX_EPOCH = 2440587.5

export interface SatRow {
  norad: string
  name: string
  groupId: string
  groupLabel: string
  category: string
  color: string
  line1: string
  line2: string
  intlDes: string
  launchKey: number
  satrec: SatRec
  epochMs: number
  inclDeg: number
  periodMin: number
  meanAltKm: number
  velKmS: number
}

export interface GroupState {
  status: FeedStatus
  rows: SatRow[]
  fetchedAt: number | null
  attemptAt: number | null
  error: string | null
  route: string | null
  stale: boolean
}

export interface GeoPos {
  lat: number
  lon: number
  altKm: number
  velKmS: number
}

function parseIntlDes(line1: string): { intlDes: string; launchKey: number } {
  const raw = line1.substring(9, 17).trim()
  const yy = parseInt(raw.substring(0, 2), 10)
  const num = parseInt(raw.substring(2, 5), 10)
  if (Number.isNaN(yy) || Number.isNaN(num)) return { intlDes: raw || '—', launchKey: 0 }
  const fullYear = yy >= 57 ? 1900 + yy : 2000 + yy
  return { intlDes: raw, launchKey: fullYear * 1000 + num }
}

function buildRow(name: string, line1: string, line2: string, def: SatGroupDef): SatRow | null {
  try {
    const satrec = twoline2satrec(line1, line2)
    if (!satrec || satrec.error !== 0 || !(satrec.no > 0)) return null
    const nRadS = satrec.no / 60
    const a = Math.cbrt(MU / (nRadS * nRadS))
    const { intlDes, launchKey } = parseIntlDes(line1)
    return {
      norad: satrec.satnum,
      name: name.trim() || `NORAD ${satrec.satnum}`,
      groupId: def.id,
      groupLabel: def.label,
      category: def.category,
      color: def.color,
      line1,
      line2,
      intlDes,
      launchKey,
      satrec,
      epochMs: (satrec.jdsatepoch - JD_UNIX_EPOCH) * 86400000,
      inclDeg: (satrec.inclo * 180) / Math.PI,
      periodMin: (2 * Math.PI) / satrec.no,
      meanAltKm: a * (1 - satrec.ecco * satrec.ecco) - RE,
      velKmS: Math.sqrt(MU / a),
    }
  } catch {
    return null
  }
}

export function parseTleText(text: string, def: SatGroupDef): SatRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
  const rows: SatRow[] = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (l.startsWith('1 ') && lines[i + 1]?.startsWith('2 ')) {
      // nameless 2-line element set
      const row = buildRow('', l, lines[i + 1], def)
      if (row) rows.push(row)
      i += 1
    } else if (!l.startsWith('2 ') && lines[i + 1]?.startsWith('1 ') && lines[i + 2]?.startsWith('2 ')) {
      const row = buildRow(l, lines[i + 1], lines[i + 2], def)
      if (row) rows.push(row)
      i += 2
    }
  }
  return rows
}

/** Propagate one satrec to a geodetic position; null if decayed/error */
export function propagateNow(satrec: SatRec, date: Date): GeoPos | null {
  const pv = propagate(satrec, date)
  if (!pv || typeof pv.position === 'boolean' || typeof pv.velocity === 'boolean') return null
  const gmst = gstime(date)
  const g = eciToGeodetic(pv.position, gmst)
  const v = pv.velocity
  return {
    lat: degreesLat(g.latitude),
    lon: degreesLong(g.longitude),
    altKm: g.height,
    velKmS: Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z),
  }
}

const EMPTY_GROUP: GroupState = {
  status: 'idle',
  rows: [],
  fetchedAt: null,
  attemptAt: null,
  error: null,
  route: null,
  stale: false,
}

export function useSatellites() {
  const [groups, setGroups] = useState<Record<string, GroupState>>({})
  const [activeGroup, setActiveGroup] = useState<string>('stations')
  const [routeStatuses, setRouteStatuses] = useState<RouteStatus[]>([])
  const groupsRef = useRef(groups)
  groupsRef.current = groups
  const inflightRef = useRef<Set<string>>(new Set())

  const loadGroup = useCallback(async (def: SatGroupDef) => {
    if (inflightRef.current.has(def.id)) return
    inflightRef.current.add(def.id)
    const prior = groupsRef.current[def.id]
    setGroups((g) => ({
      ...g,
      [def.id]: {
        ...(g[def.id] ?? EMPTY_GROUP),
        // keep prior status while refreshing a loaded group; only show STALE on actual failure
        status: prior?.rows.length ? prior.status : 'connecting',
        attemptAt: Date.now(),
      },
    }))
    const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${def.celestrakGroup}&FORMAT=TLE`
    try {
      const { res, routeIndex, routeStatuses: rs } = await fetchViaChain(url, { timeoutMs: 20000 })
      setRouteStatuses(rs)
      const text = await res.text()
      const rows = parseTleText(text, def)
      if (rows.length === 0) throw new Error('TLE parse yielded 0 elements')
      setGroups((g) => ({
        ...g,
        [def.id]: {
          status: 'live',
          rows,
          fetchedAt: Date.now(),
          attemptAt: Date.now(),
          error: null,
          route: PROXY_ROUTES[routeIndex]?.label ?? null,
          stale: false,
        },
      }))
    } catch (e) {
      const rs = (e as { routeStatuses?: RouteStatus[] }).routeStatuses
      if (rs) setRouteStatuses(rs)
      const msg = e instanceof Error ? e.message : 'fetch failed'
      setGroups((g) => {
        const prev = g[def.id] ?? EMPTY_GROUP
        return {
          ...g,
          [def.id]: {
            ...prev,
            status: prev.rows.length ? 'stale' : 'error',
            error: msg,
            stale: prev.rows.length > 0,
          },
        }
      })
    } finally {
      inflightRef.current.delete(def.id)
    }
  }, [])

  // Initial load: active group first, then background-load remaining groups for live chip counts
  useEffect(() => {
    let cancelled = false
    const first = SAT_GROUPS.find((d) => d.id === 'stations')!
    void loadGroup(first)
    const others = SAT_GROUPS.filter((d) => d.id !== 'stations')
    let i = 0
    const step = () => {
      if (cancelled || i >= others.length) return
      const def = others[i++]
      const existing = groupsRef.current[def.id]
      if (!existing || existing.status === 'idle') void loadGroup(def)
      setTimeout(step, 600)
    }
    const t = setTimeout(step, 1500)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [loadGroup])

  // 30-min refresh cadence for loaded groups + 2-min retry for failed ones
  useEffect(() => {
    const id = setInterval(() => {
      for (const def of SAT_GROUPS) {
        const st = groupsRef.current[def.id]
        if (!st) continue
        if (st.fetchedAt && Date.now() - st.fetchedAt >= TLE_REFRESH_MS) void loadGroup(def)
        else if (st.status === 'error' && (!st.attemptAt || Date.now() - st.attemptAt >= 120000)) void loadGroup(def)
      }
    }, 30000)
    return () => clearInterval(id)
  }, [loadGroup])

  const selectGroup = useCallback(
    (id: string) => {
      setActiveGroup(id)
      const def = SAT_GROUPS.find((d) => d.id === id)
      const st = groupsRef.current[id]
      if (def && (!st || st.status === 'idle' || st.status === 'error')) void loadGroup(def)
    },
    [loadGroup],
  )

  const active = groups[activeGroup] ?? EMPTY_GROUP

  /** Union count of unique NORAD IDs across all loaded groups (header stat) */
  const totalUnique = useMemo(() => {
    const set = new Set<string>()
    for (const st of Object.values(groups)) for (const r of st.rows) set.add(r.norad)
    return set.size
  }, [groups])

  const groupCounts = useMemo(() => {
    const out: Record<string, number | null> = {}
    for (const def of SAT_GROUPS) {
      const st = groups[def.id]
      out[def.id] = st && st.rows.length ? st.rows.length : null
    }
    return out
  }, [groups])

  const anyLive = Object.values(groups).some((s) => s.status === 'live')
  const latestFetch = Math.max(0, ...Object.values(groups).map((s) => s.fetchedAt ?? 0)) || null

  return {
    groups,
    activeGroup,
    selectGroup,
    active,
    groupCounts,
    totalUnique,
    anyLive,
    latestFetch,
    routeStatuses,
    reloadActive: useCallback(() => {
      const def = SAT_GROUPS.find((d) => d.id === activeGroup)
      if (def) void loadGroup(def)
    }, [activeGroup, loadGroup]),
  }
}
