import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Crosshair, Search } from 'lucide-react'
import { C, F, HudPanel, LiveDot, StatusChip, ageText, useNow, usePrefersReducedMotion } from './hud'
import { PROXY_ROUTES } from './net'
import { AC_REGIONS, classifyAc } from './useAircraft'
import type { AcRow, AircraftFeed, AcFilter } from './useAircraft'

const ROW_H = 34
const EXPAND_H = 120
const GRID = '110px 76px 64px 78px 72px 70px 76px 84px 88px 60px'

const FILTERS: { id: AcFilter; label: string }[] = [
  { id: 'all', label: 'ALL' },
  { id: 'mil', label: 'MIL-TYPE' },
  { id: 'heli', label: 'HELI' },
  { id: 'heavy', label: 'HEAVY' },
  { id: 'squawk', label: 'SQUAWK 7X00' },
]

type SortKey = 'callsign' | 'hex' | 'type' | 'alt' | 'gs' | 'track' | 'squawk' | 'lat' | 'lon' | 'age'
const COLS: { key: SortKey; label: string }[] = [
  { key: 'callsign', label: 'CALLSIGN' },
  { key: 'hex', label: 'ICAO24' },
  { key: 'type', label: 'TYPE' },
  { key: 'alt', label: 'ALT FT' },
  { key: 'gs', label: 'GS KT' },
  { key: 'track', label: 'TRACK°' },
  { key: 'squawk', label: 'SQUAWK' },
  { key: 'lat', label: 'LAT' },
  { key: 'lon', label: 'LON' },
  { key: 'age', label: 'AGE' },
]

export default function AircraftPanel({ feed }: { feed: AircraftFeed }) {
  const now = useNow(1000)
  const reduced = usePrefersReducedMotion()
  const [sortKey, setSortKey] = useState<SortKey>('callsign')
  const [sortAsc, setSortAsc] = useState(true)
  const [expandedHex, setExpandedHex] = useState<string | null>(null)

  const sorted = useMemo(() => {
    const arr = [...feed.filteredRows]
    const dir = sortAsc ? 1 : -1
    const val = (r: AcRow): number | string => {
      switch (sortKey) {
        case 'callsign':
          return r.callsign || '~~~' // sort blanks last
        case 'hex':
          return r.hex
        case 'type':
          return r.type || '~~~'
        case 'alt':
          return r.altFt ?? (r.onGround ? 0 : -1)
        case 'gs':
          return r.gsKt ?? -1
        case 'track':
          return r.trackDeg ?? -1
        case 'squawk':
          return r.squawk ?? '~~~~'
        case 'lat':
          return r.lat ?? 999
        case 'lon':
          return r.lon ?? 999
        case 'age':
          return r.seenSec
      }
    }
    arr.sort((a, b) => {
      // emergencies always float to top regardless of sort
      if (a.emergency !== b.emergency) return a.emergency ? -1 : 1
      const va = val(a)
      const vb = val(b)
      if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb)) * dir
      return (va - vb) * dir
    })
    return arr
  }, [feed.filteredRows, sortKey, sortAsc])

  // simple windowing (aircraft counts are bounded by receiver grid)
  const [scrollTop, setScrollTop] = useState(0)
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 8)
  const end = Math.min(sorted.length - 1, Math.ceil((scrollTop + 560) / ROW_H) + 8)
  const expandedIndex = expandedHex ? sorted.findIndex((r) => r.hex === expandedHex) : -1
  const expH = expandedIndex >= 0 ? EXPAND_H : 0
  const rowOffset = (i: number) => i * ROW_H + (expandedIndex >= 0 && i > expandedIndex ? expH : 0)
  const totalHeight = sorted.length * ROW_H + expH

  const emergencyPulse = new Set(feed.emergencies.slice(0, 3).map((r) => r.hex))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Control row */}
      <HudPanel style={{ padding: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              border: `1px solid ${C.line}`,
              background: C.bg1,
              padding: '0 10px',
              height: 34,
              minWidth: 220,
            }}
          >
            <Search size={13} color={C.inkFaint} />
            <input
              value={feed.query}
              onChange={(e) => feed.setQuery(e.target.value)}
              placeholder="CALLSIGN / ICAO24"
              style={{
                background: 'none',
                border: 'none',
                outline: 'none',
                color: C.ink,
                fontFamily: F.mono,
                fontSize: 12,
                width: '100%',
              }}
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {FILTERS.map((f) => {
              const on = feed.filter === f.id
              return (
                <button
                  key={f.id}
                  onClick={() => feed.setFilter(f.id)}
                  style={{
                    height: 28,
                    padding: '0 10px',
                    border: `1px solid ${on ? C.amber : C.line}`,
                    background: on ? C.bg3 : 'transparent',
                    cursor: 'pointer',
                    fontFamily: F.display,
                    fontWeight: 500,
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    color: on ? C.ink : C.inkDim,
                  }}
                >
                  {f.label}
                  {f.id === 'squawk' && feed.emergencies.length > 0 && (
                    <span style={{ marginLeft: 6, color: C.red, fontFamily: F.mono }}>{feed.emergencies.length}</span>
                  )}
                </button>
              )
            })}
            <span style={{ alignSelf: 'center', fontFamily: F.mono, fontSize: 9, color: C.inkFaint, letterSpacing: '0.08em' }}>
              TYPE/MIL INFERRED FROM ADS-B FIELDS · HEURISTIC
            </span>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span
              style={{
                border: `1px solid ${C.amber}55`,
                padding: '5px 10px',
                fontFamily: F.body,
                fontSize: 11,
                color: C.amber,
                whiteSpace: 'nowrap',
              }}
            >
              COVERAGE: RECEIVER GRID — VIEWPORT + HOTSPOTS ({AC_REGIONS.length} REGIONS)
            </span>
            <span
              className="wf-tabular"
              style={{
                border: `1px solid ${C.line}`,
                padding: '5px 10px',
                fontFamily: F.mono,
                fontSize: 11,
                color: C.inkDim,
                whiteSpace: 'nowrap',
              }}
            >
              NEXT POLL <span style={{ color: C.cyan }}>{String(feed.nextPollInSec).padStart(2, '0')}s</span>
              {feed.backoffLevel > 0 && <span style={{ color: C.amber }}> · BACKOFF ×{feed.backoffLevel}</span>}
            </span>
          </div>
        </div>
      </HudPanel>

      {/* Degraded state: all proxy routes failed */}
      {feed.allRoutesFailed && (
        <HudPanel accent={C.red} style={{ padding: 20, borderLeft: `3px solid ${C.red}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: F.display, fontWeight: 600, fontSize: 13, letterSpacing: '0.1em', color: C.red }}>
            <AlertTriangle size={15} />
            ADS-B UPLINK DEGRADED — ALL PROXY ROUTES FAILED · RETRY IN {String(feed.nextPollInSec).padStart(2, '0')}s
          </div>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {PROXY_ROUTES.map((r, i) => {
              const st = feed.routeStatuses[i]
              const dotColor = st === 'ok' ? C.green : st === 'fail' ? C.red : st === 'ratelimited' ? C.amber : C.inkFaint
              const text =
                st === 'ok' ? 'REACHABLE' : st === 'fail' ? 'FAILED' : st === 'ratelimited' ? 'RATE-LIMITED (429)' : 'UNTESTED'
              return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: F.mono, fontSize: 11 }}>
                  <LiveDot color={dotColor} size={7} />
                  <span style={{ color: C.inkDim, width: 130 }}>{r.label}</span>
                  <span style={{ color: C.inkFaint }}>{text}</span>
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: 10, fontFamily: F.mono, fontSize: 10, color: C.inkFaint }}>
            LAST ERROR: {feed.error ?? '—'} · SOURCE: API.ADSB.LOL · BACKOFF 10s→15s→30s
          </div>
        </HudPanel>
      )}

      {/* Stat strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        {[
          { label: 'AIRCRAFT', value: feed.count.toLocaleString(), color: C.amber },
          { label: 'AVG ALT', value: feed.avgAltFt != null ? `${feed.avgAltFt.toLocaleString()} FT` : '—', color: C.ink },
          { label: 'AVG GS', value: feed.avgGsKt != null ? `${feed.avgGsKt} KT` : '—', color: C.ink },
          { label: 'REGIONS POLLED', value: `${feed.regionsPolled}/${AC_REGIONS.length}`, color: C.ink },
          { label: 'LAST POLL', value: `${ageText(feed.lastPollMs, now)} AGO`, color: C.ink },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ delay: i * 0.07, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            <HudPanel style={{ padding: '12px 14px' }}>
              <div style={{ fontFamily: F.display, fontSize: 10, letterSpacing: '0.12em', color: C.inkFaint }}>{s.label}</div>
              <div className="wf-tabular" style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 20, lineHeight: '26px', color: s.color, marginTop: 4 }}>
                {s.value}
              </div>
            </HudPanel>
          </motion.div>
        ))}
      </div>

      {/* Emergency banner */}
      {feed.emergencies.length > 0 && (
        <div
          style={{
            border: `1px solid ${C.red}`,
            borderLeft: `3px solid ${C.red}`,
            background: 'rgba(255,59,71,0.06)',
            padding: '8px 14px',
            fontFamily: F.mono,
            fontSize: 11,
            color: C.red,
            letterSpacing: '0.05em',
          }}
        >
          {feed.emergencies.length} ACTIVE EMERGENCY SQUAWK{feed.emergencies.length > 1 ? 'S' : ''} ·{' '}
          {feed.emergencies
            .slice(0, 4)
            .map((r) => `${r.callsign || r.hex} ${r.squawk}${r.squawk === '7700' ? '(EMERG)' : r.squawk === '7600' ? '(RADIO FAIL)' : '(HIJACK)'}`)
            .join(' · ')}
        </div>
      )}

      {/* Table */}
      <HudPanel style={{ overflow: 'hidden' }} glow={feed.status === 'live'}>
        {feed.lastPollMs != null && !reduced && (
          <div
            key={feed.lastPollMs}
            className="wf-sweep"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              height: 1,
              background: C.cyan,
              boxShadow: `0 0 12px ${C.cyan}`,
              zIndex: 5,
              pointerEvents: 'none',
            }}
          />
        )}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: GRID,
            gap: 8,
            padding: '10px 14px',
            borderBottom: `1px solid ${C.line}`,
            background: C.bg1,
          }}
        >
          {COLS.map((c) => (
            <button
              key={c.key}
              onClick={() => {
                if (sortKey === c.key) setSortAsc((a) => !a)
                else {
                  setSortKey(c.key)
                  setSortAsc(true)
                }
              }}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                textAlign: 'left',
                fontFamily: F.display,
                fontWeight: 500,
                fontSize: 10,
                letterSpacing: '0.12em',
                color: sortKey === c.key ? C.amber : C.inkFaint,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              {c.label} {sortKey === c.key ? (sortAsc ? '▲' : '▼') : ''}
            </button>
          ))}
        </div>

        {sorted.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <div style={{ fontFamily: F.display, fontSize: 13, letterSpacing: '0.1em', color: feed.status === 'error' ? C.red : C.inkDim }}>
              {feed.status === 'error' ? 'ADS-B UPLINK OFFLINE' : feed.query || feed.filter !== 'all' ? 'NO TARGETS MATCH CURRENT FILTER' : 'ACQUIRING TRANSPONDER PINGS…'}
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 11, color: C.inkFaint, marginTop: 8 }}>
              {feed.status === 'error'
                ? feed.error ?? 'all proxy routes failed'
                : 'POLLING ADSB.LOL RECEIVER GRID — FIRST RESULTS LAND WITHIN ONE CYCLE'}
            </div>
          </div>
        ) : (
          <div
            onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
            className="wf-scroll"
            style={{ height: 560, overflowY: 'auto', position: 'relative' }}
          >
            <div style={{ height: totalHeight, position: 'relative' }}>
              {sorted.slice(start, end + 1).map((r, i) => {
                const idx = start + i
                const expanded = idx === expandedIndex
                const cls = classifyAc(r)
                return (
                  <div key={r.hex} style={{ position: 'absolute', top: rowOffset(idx), left: 0, right: 0 }}>
                    <div
                      onClick={() => setExpandedHex(expanded ? null : r.hex)}
                      className={`wf-rowhover wf-tabular${r.emergency && emergencyPulse.has(r.hex) && !reduced ? ' wf-pulse-red' : ''}`}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: GRID,
                        gap: 8,
                        height: ROW_H,
                        alignItems: 'center',
                        padding: '0 14px',
                        cursor: 'pointer',
                        background: expanded ? C.bg3 : r.emergency ? 'rgba(255,59,71,0.05)' : 'transparent',
                        borderLeft: r.emergency ? `2px solid ${C.red}` : expanded ? `2px solid ${C.amber}` : '2px solid transparent',
                        fontFamily: F.mono,
                        fontSize: 13,
                        color: C.ink,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span style={{ color: r.callsign ? C.ink : C.inkFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.callsign || 'NO CALLSIGN'}
                      </span>
                      <span style={{ color: C.inkDim }}>{r.hex.toUpperCase()}</span>
                      <span style={{ color: cls.mil ? C.red : C.inkDim, fontSize: 11 }} title={cls.mil ? 'MIL-TYPE (HEURISTIC)' : undefined}>
                        {r.type || '—'}
                      </span>
                      <span>{r.onGround ? 'GND' : r.altFt != null ? r.altFt.toLocaleString() : '—'}</span>
                      <span>{r.gsKt != null ? Math.round(r.gsKt) : '—'}</span>
                      <span>{r.trackDeg != null ? Math.round(r.trackDeg) : '—'}</span>
                      <span style={{ color: r.emergency ? C.red : C.inkDim, fontWeight: r.emergency ? 700 : 400 }}>
                        {r.squawk ?? '—'}
                      </span>
                      <span style={{ color: C.inkDim }}>{r.lat != null ? r.lat.toFixed(2) : '—'}</span>
                      <span style={{ color: C.inkDim }}>{r.lon != null ? r.lon.toFixed(2) : '—'}</span>
                      <span style={{ color: r.seenSec > 60 ? C.amber : C.inkFaint, fontSize: 11 }}>{r.seenSec}s</span>
                    </div>
                    {expanded && (
                      <div
                        style={{
                          height: EXPAND_H,
                          overflow: 'hidden',
                          borderLeft: `2px solid ${C.amber}`,
                          background: C.bg1,
                          padding: '12px 14px',
                          display: 'flex',
                          gap: 24,
                          flexWrap: 'wrap',
                          alignItems: 'flex-start',
                        }}
                      >
                        <div style={{ fontFamily: F.mono, fontSize: 11, color: C.inkDim, lineHeight: '18px' }}>
                          <div>REGION <span style={{ color: C.ink }}>{r.region}</span> · CATEGORY <span style={{ color: C.ink }}>{r.category || '—'}</span></div>
                          <div>
                            HEURISTICS{' '}
                            <span style={{ color: C.ink }}>
                              {cls.mil ? 'MIL-TYPE ' : ''}
                              {cls.heli ? 'HELI ' : ''}
                              {cls.heavy ? 'HEAVY' : ''}
                              {!cls.mil && !cls.heli && !cls.heavy ? 'NONE' : ''}
                            </span>
                          </div>
                          <div style={{ color: C.inkFaint, fontSize: 10 }}>SOURCE: ADSB.LOL RECEIVER GRID · {ageText(feed.lastPollMs, now)} AGO · SEEN {r.seenSec}s</div>
                        </div>
                        <a
                          href={`/?focus=ac-${r.hex}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            border: `1px solid ${C.amber}`,
                            color: C.amber,
                            background: 'rgba(255,176,32,0.07)',
                            fontFamily: F.display,
                            fontWeight: 600,
                            fontSize: 11,
                            letterSpacing: '0.12em',
                            padding: '8px 14px',
                            textDecoration: 'none',
                          }}
                        >
                          <Crosshair size={12} />
                          FLY TO →
                        </a>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            borderTop: `1px solid ${C.line}`,
            padding: '8px 14px',
            fontFamily: F.mono,
            fontSize: 10,
            color: C.inkFaint,
          }}
        >
          <span>
            {sorted.length.toLocaleString()} SHOWN · {feed.count.toLocaleString()} POSITIONED TARGETS · SORT {sortKey.toUpperCase()}{' '}
            {sortAsc ? '▲' : '▼'}
          </span>
          <StatusChip
            status={feed.status}
            label={`SOURCE: ADSB.LOL${feed.route ? ` VIA ${feed.route}` : ''}`}
            age={`${ageText(feed.lastPollMs, now)} AGO`}
          />
        </div>
      </HudPanel>
    </div>
  )
}
