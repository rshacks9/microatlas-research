import { useEffect, useRef, useState, useCallback } from 'react'
import { fetchViaChain } from './net'
import type { FeedStatus } from './hud'

/** Digitraffic AIS — Finnish / Baltic waters, live, keyless, CORS-open */
export const DIGITRAFFIC_ENDPOINT = 'https://meri.digitraffic.fi/api/ais/v1/locations'
const DIGITRAFFIC_POLL_MS = 30000
const AISSTREAM_KEY_STORAGE = 'wf_aisstream_key'
const AISSTREAM_PRUNE_MS = 10 * 60 * 1000
const AISSTREAM_CAP = 5000

export interface ShipRow {
  mmsi: number
  name: string
  sog: number | null
  cog: number | null
  hdg: number | null
  navStat: number | null
  lat: number
  lon: number
  tsMs: number
  src: 'digitraffic' | 'aisstream'
}

interface DigiFeature {
  geometry?: { coordinates?: [number, number] }
  properties?: {
    mmsi?: number
    sog?: number
    cog?: number
    navStat?: number
    heading?: number
    /** AIS slot seconds — NOT an epoch; real epoch is timestampExternal */
    timestamp?: number
    timestampExternal?: number
  }
}

interface AisStreamMsg {
  MessageType?: string
  MetaData?: { MMSI?: number; latitude?: number; longitude?: number; time_utc?: string; ShipName?: string }
  Message?: { PositionReport?: { Sog?: number; Cog?: number; TrueHeading?: number } }
}

export type AisStreamState = 'off' | 'connecting' | 'live' | 'error'

export interface ShipsFeed {
  status: FeedStatus
  rows: ShipRow[]
  count: number
  avgSog: number | null
  feedUpdatedMs: number | null
  lastFetchMs: number | null
  error: string | null
  query: string
  setQuery: (q: string) => void
  filteredRows: ShipRow[]
  aisstreamKey: string
  saveAisstreamKey: (k: string) => void
  clearAisstreamKey: () => void
  aisstreamState: AisStreamState
  aisstreamCount: number
}

export function useShips(): ShipsFeed {
  const [digitraffic, setDigitraffic] = useState<Map<number, ShipRow>>(new Map())
  const [aisstream, setAisstream] = useState<Map<number, ShipRow>>(new Map())
  const [status, setStatus] = useState<FeedStatus>('idle')
  const [feedUpdatedMs, setFeedUpdatedMs] = useState<number | null>(null)
  const [lastFetchMs, setLastFetchMs] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [aisstreamKey, setAisstreamKey] = useState<string>(() => {
    try {
      return localStorage.getItem(AISSTREAM_KEY_STORAGE) ?? ''
    } catch {
      return ''
    }
  })
  const [aisstreamState, setAisstreamState] = useState<AisStreamState>('off')
  const wsBufferRef = useRef<Map<number, ShipRow>>(new Map())

  // Digitraffic poll (30s cadence per design)
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (stopped) return
      setStatus((s) => (s === 'live' ? s : 'connecting'))
      try {
        const { res } = await fetchViaChain(DIGITRAFFIC_ENDPOINT, { timeoutMs: 20000 })
        const data = (await res.json()) as { features?: DigiFeature[]; dataUpdatedTime?: string }
        const feedTs = data.dataUpdatedTime ? Date.parse(data.dataUpdatedTime) : 0
        const next = new Map<number, ShipRow>()
        let maxTs = feedTs
        for (const f of data.features ?? []) {
          const p = f.properties
          const coords = f.geometry?.coordinates
          if (!p?.mmsi || !coords) continue
          const ts =
            typeof p.timestampExternal === 'number' && p.timestampExternal > 0
              ? p.timestampExternal
              : feedTs || Date.now()
          if (ts > maxTs) maxTs = ts
          next.set(p.mmsi, {
            mmsi: p.mmsi,
            name: '',
            sog: typeof p.sog === 'number' ? p.sog : null,
            cog: typeof p.cog === 'number' ? p.cog : null,
            hdg: typeof p.heading === 'number' && p.heading !== 511 ? p.heading : null,
            navStat: typeof p.navStat === 'number' ? p.navStat : null,
            lat: coords[1],
            lon: coords[0],
            tsMs: ts,
            src: 'digitraffic',
          })
        }
        if (next.size === 0) throw new Error('AIS payload contained 0 vessels')
        setDigitraffic(next)
        setFeedUpdatedMs(maxTs || Date.now())
        setLastFetchMs(Date.now())
        setStatus('live')
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'fetch failed')
        setStatus((s) => (s === 'live' ? 'stale' : 'error'))
      }
      if (!stopped) timer = setTimeout(() => void poll(), DIGITRAFFIC_POLL_MS)
    }
    void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [])

  // Optional aisstream.io global feed (user-supplied key, stored locally)
  useEffect(() => {
    if (!aisstreamKey) {
      setAisstreamState('off')
      setAisstream(new Map())
      return
    }
    setAisstreamState('connecting')
    let ws: WebSocket | null = null
    let stopped = false
    try {
      ws = new WebSocket('wss://stream.aisstream.io/v0/stream')
    } catch {
      setAisstreamState('error')
      return
    }
    ws.onopen = () => {
      ws?.send(
        JSON.stringify({
          APIKey: aisstreamKey,
          BoundingBoxes: [
            [
              [-90, -180],
              [90, 180],
            ],
          ],
          FilterMessageTypes: ['PositionReport'],
        }),
      )
      setAisstreamState('live')
    }
    ws.onerror = () => setAisstreamState('error')
    ws.onclose = () => {
      if (!stopped) setAisstreamState('error')
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as AisStreamMsg
        if (msg.MessageType !== 'PositionReport') return
        const meta = msg.MetaData
        const rep = msg.Message?.PositionReport
        const mmsi = meta?.MMSI
        const lat = meta?.latitude
        const lon = meta?.longitude
        if (mmsi == null || lat == null || lon == null) return
        const buf = wsBufferRef.current
        if (buf.size >= AISSTREAM_CAP && !buf.has(mmsi)) return
        buf.set(mmsi, {
          mmsi,
          name: (meta?.ShipName ?? '').trim(),
          sog: typeof rep?.Sog === 'number' ? rep.Sog : null,
          cog: typeof rep?.Cog === 'number' ? rep.Cog : null,
          hdg: typeof rep?.TrueHeading === 'number' && rep.TrueHeading !== 511 ? rep.TrueHeading : null,
          navStat: null,
          lat,
          lon,
          tsMs: meta?.time_utc ? Date.parse(meta.time_utc) : Date.now(),
          src: 'aisstream',
        })
      } catch {
        /* malformed frame — ignore */
      }
    }
    // Flush buffered socket updates at 1 Hz to avoid render storms
    const flush = setInterval(() => {
      if (wsBufferRef.current.size > 0) {
        const snap = new Map(wsBufferRef.current)
        const cutoff = Date.now() - AISSTREAM_PRUNE_MS
        for (const [k, v] of snap) if (v.tsMs < cutoff) snap.delete(k)
        setAisstream(snap)
      }
    }, 1000)
    return () => {
      stopped = true
      clearInterval(flush)
      wsBufferRef.current = new Map()
      ws?.close()
    }
  }, [aisstreamKey])

  const saveAisstreamKey = useCallback((k: string) => {
    const trimmed = k.trim()
    try {
      if (trimmed) localStorage.setItem(AISSTREAM_KEY_STORAGE, trimmed)
      else localStorage.removeItem(AISSTREAM_KEY_STORAGE)
    } catch {
      /* storage unavailable */
    }
    setAisstreamKey(trimmed)
  }, [])
  const clearAisstreamKey = useCallback(() => saveAisstreamKey(''), [saveAisstreamKey])

  // Merge: aisstream overlays digitraffic by MMSI
  const merged = new Map<number, ShipRow>(digitraffic)
  for (const [k, v] of aisstream) merged.set(k, v)
  const rows = Array.from(merged.values())

  let sogSum = 0
  let sogN = 0
  for (const r of rows) {
    if (r.sog != null) {
      sogSum += r.sog
      sogN += 1
    }
  }

  const q = query.trim()
  const filteredRows = q
    ? rows.filter((r) => String(r.mmsi).includes(q) || r.name.toUpperCase().includes(q.toUpperCase()))
    : rows

  return {
    status,
    rows,
    count: rows.length,
    avgSog: sogN ? Math.round((sogSum / sogN) * 10) / 10 : null,
    feedUpdatedMs,
    lastFetchMs,
    error,
    query,
    setQuery,
    filteredRows,
    aisstreamKey,
    saveAisstreamKey,
    clearAisstreamKey,
    aisstreamState,
    aisstreamCount: aisstream.size,
  }
}
