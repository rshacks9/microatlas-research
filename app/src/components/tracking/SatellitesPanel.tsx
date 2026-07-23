import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowDown, ArrowUp, Crosshair, Search } from 'lucide-react'
import { C, F, HudPanel, LiveDot, StatusChip, ageText, epochAgeText, useNow, usePrefersReducedMotion, useVirtualWindow } from './hud'
import type { FeedStatus } from './hud'
import { SAT_GROUPS, propagateNow } from './useSatellites'
import type { SatRow, GroupState, GeoPos } from './useSatellites'

const ROW_H = 34
const EXPAND_H = 132
const GRID = '72px minmax(170px,1fr) 96px 78px 84px 66px 84px 84px 88px 78px'

type SortKey = 'norad' | 'name' | 'group' | 'alt' | 'vel' | 'incl' | 'period' | 'lat' | 'lon' | 'epoch'

const COLS: { key: SortKey; label: string }[] = [
  { key: 'norad', label: 'NORAD' },
  { key: 'name', label: 'NAME' },
  { key: 'group', label: 'GROUP' },
  { key: 'alt', label: 'ALT KM' },
  { key: 'vel', label: 'VEL KM·S⁻¹' },
  { key: 'incl', label: 'INCL°' },
  { key: 'period', label: 'PERIOD MIN' },
  { key: 'lat', label: 'LAT' },
  { key: 'lon', label: 'LON' },
  { key: 'epoch', label: 'EPOCH AGE' },
]

interface LiveCell extends GeoPos {
  flash: boolean
}

export default function SatellitesPanel({
  active,
  activeGroup,
  selectGroup,
  groupCounts,
}: {
  active: GroupState
  activeGroup: string
  selectGroup: (id: string) => void
  groupCounts: Record<string, number | null>
}) {
  const now = useNow(1000)
  const reduced = usePrefersReducedMotion()
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortAsc, setSortAsc] = useState(true)
  const [expandedNorad, setExpandedNorad] = useState<string | null>(null)
  const [livePos, setLivePos] = useState<Record<string, LiveCell>>({})
  const geoCacheRef = useRef<Map<string, GeoPos>>(new Map())
  const firstPaintRef = useRef(true)

  useEffect(() => {
    const t = setTimeout(() => {
      firstPaintRef.current = false
    }, 1500)
    return () => clearTimeout(t)
  }, [])

  const rows = active.rows

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase()
    if (!q) return rows
    return rows.filter((r) => r.name.toUpperCase().includes(q) || r.norad.includes(q))
  }, [rows, query])

  // One-off full-catalog geodetic snapshot when sorting by LAT/LON (sort-only cache)
  useEffect(() => {
    if (sortKey !== 'lat' && sortKey !== 'lon') return
    const date = new Date()
    const cache = new Map<string, GeoPos>()
    for (const r of rows) {
      const p = propagateNow(r.satrec, date)
      if (p) cache.set(r.norad, p)
    }
    geoCacheRef.current = cache
  }, [sortKey, rows])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    const dir = sortAsc ? 1 : -1
    const geo = geoCacheRef.current
    const val = (r: SatRow): number | string => {
      switch (sortKey) {
        case 'norad':
          return parseInt(r.norad, 10) || 0
        case 'name':
          return r.name
        case 'group':
          return r.groupLabel
        case 'alt':
          return r.meanAltKm
        case 'vel':
          return r.velKmS
        case 'incl':
          return r.inclDeg
        case 'period':
          return r.periodMin
        case 'lat':
          return geo.get(r.norad)?.lat ?? livePos[r.norad]?.lat ?? 999
        case 'lon':
          return geo.get(r.norad)?.lon ?? livePos[r.norad]?.lon ?? 999
        case 'epoch':
          return r.epochMs
      }
    }
    arr.sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb)) * dir
      return (va - vb) * dir
    })
    return arr
  }, [filtered, sortKey, sortAsc, livePos])

  const expandedIndex = useMemo(
    () => (expandedNorad ? sorted.findIndex((r) => r.norad === expandedNorad) : -1),
    [expandedNorad, sorted],
  )

  const vw = useVirtualWindow(sorted.length, ROW_H, expandedIndex, EXPAND_H)

  // 1 Hz live propagation of the visible window only (SGP4, in-browser)
  const startRef = useRef(vw.start)
  const endRef = useRef(vw.end)
  startRef.current = vw.start
  endRef.current = vw.end
  const sortedRef = useRef(sorted)
  sortedRef.current = sorted
  useEffect(() => {
    const id = setInterval(() => {
      const date = new Date()
      const slice = sortedRef.current.slice(startRef.current, endRef.current + 1)
      setLivePos((prev) => {
        const next: Record<string, LiveCell> = {}
        for (const r of slice) {
          const p = propagateNow(r.satrec, date)
          if (!p) continue
          const old = prev[r.norad]
          const flash =
            !reduced && !!old && (Math.abs(old.lat - p.lat) > 0.0005 || Math.abs(old.lon - p.lon) > 0.0005)
          next[r.norad] = { ...p, flash }
        }
        return next
      })
    }, 1000)
    return () => clearInterval(id)
  }, [reduced])

  // Live stats strip — all computed from the loaded TLE set
  const stats = useMemo(() => {
    if (!rows.length) return null
    let altSum = 0
    let fastest = rows[0]
    let lowest = rows[0]
    let newest = rows[0]
    let maxEpoch = rows[0].epochMs
    for (const r of rows) {
      altSum += r.meanAltKm
      if (r.velKmS > fastest.velKmS) fastest = r
      if (r.meanAltKm < lowest.meanAltKm) lowest = r
      if (r.launchKey > newest.launchKey) newest = r
      if (r.epochMs > maxEpoch) maxEpoch = r.epochMs
    }
    return {
      tracked: rows.length,
      meanAlt: Math.round(altSum / rows.length),
      fastest,
      lowest,
      newest,
      maxEpoch,
    }
  }, [rows])

  const feedStatus: FeedStatus = active.status
  const isEmpty = !rows.length && (feedStatus === 'idle' || feedStatus === 'connecting')

  const headerCell = (key: SortKey, label: string) => (
    <button
      key={key}
      onClick={() => {
        if (sortKey === key) setSortAsc((a) => !a)
        else {
          setSortKey(key)
          setSortAsc(true)
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        fontFamily: F.display,
        fontWeight: 500,
        fontSize: 10,
        letterSpacing: '0.12em',
        color: sortKey === key ? C.cyan : C.inkFaint,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
      {sortKey === key && (sortAsc ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
    </button>
  )

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
              minWidth: 240,
            }}
          >
            <Search size={13} color={C.inkFaint} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="NAME / NORAD ID"
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
            {SAT_GROUPS.map((g) => {
              const activeChip = g.id === activeGroup
              const count = groupCounts[g.id]
              return (
                <button
                  key={g.id}
                  onClick={() => selectGroup(g.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    height: 28,
                    padding: '0 10px',
                    border: `1px solid ${activeChip ? g.color : C.line}`,
                    background: activeChip ? C.bg3 : 'transparent',
                    cursor: 'pointer',
                    fontFamily: F.display,
                    fontWeight: 500,
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    color: activeChip ? C.ink : C.inkDim,
                  }}
                >
                  <LiveDot color={g.color} size={6} />
                  {g.label}
                  <span style={{ fontFamily: F.mono, fontSize: 10, color: C.inkFaint }}>
                    {count == null ? '···' : count.toLocaleString()}
                  </span>
                </button>
              )
            })}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {[
                { label: 'CREWED', color: C.cyan },
                { label: 'NAV', color: C.blue },
                { label: 'COMMS', color: C.amber },
                { label: 'WX', color: C.violet },
                { label: 'NEW', color: C.orange },
              ].map((l) => (
                <span
                  key={l.label}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: F.mono, fontSize: 10, color: C.inkFaint }}
                >
                  <LiveDot color={l.color} size={6} />
                  {l.label}
                </span>
              ))}
            </div>
            {stats && (
              <span
                style={{
                  border: `1px solid ${C.line}`,
                  padding: '5px 10px',
                  fontFamily: F.mono,
                  fontSize: 11,
                  color: C.inkDim,
                  whiteSpace: 'nowrap',
                }}
              >
                TLE EPOCH <span style={{ color: C.cyan }}>{epochAgeText(stats.maxEpoch, now)}</span> OLD
              </span>
            )}
          </div>
        </div>
      </HudPanel>

      {/* Stale banner */}
      {active.stale && (
        <div
          style={{
            border: `1px solid ${C.amber}`,
            borderLeft: `3px solid ${C.amber}`,
            background: 'rgba(255,176,32,0.06)',
            padding: '8px 14px',
            fontFamily: F.mono,
            fontSize: 11,
            color: C.amber,
            letterSpacing: '0.06em',
          }}
        >
          STALE · SHOWING LAST-GOOD TLE SET{stats ? ` · EPOCH ${epochAgeText(stats.maxEpoch, now)} OLD` : ''} ·{' '}
          {active.error ?? 'refresh pending'}
        </div>
      )}

      {/* Orbit stat strip */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
          {[
            { label: 'TRACKED', value: stats.tracked.toLocaleString(), sub: SAT_GROUPS.find((g) => g.id === activeGroup)?.label ?? '' },
            { label: 'MEAN ALT', value: `${stats.meanAlt.toLocaleString()} KM`, sub: 'CATALOG MEAN' },
            { label: 'FASTEST', value: `${stats.fastest.velKmS.toFixed(2)} KM/S`, sub: stats.fastest.name },
            { label: 'LOWEST', value: `${Math.round(stats.lowest.meanAltKm).toLocaleString()} KM`, sub: stats.lowest.name },
            { label: 'NEWEST LAUNCH', value: stats.newest.intlDes || '—', sub: stats.newest.name },
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
                <div
                  className="wf-tabular"
                  style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 20, lineHeight: '26px', color: C.cyan, marginTop: 4 }}
                >
                  {s.value}
                </div>
                <div
                  style={{
                    fontFamily: F.mono,
                    fontSize: 10,
                    color: C.inkDim,
                    marginTop: 2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {s.sub}
                </div>
              </HudPanel>
            </motion.div>
          ))}
        </div>
      )}

      {/* Table */}
      <HudPanel style={{ overflow: 'hidden', opacity: active.stale ? 0.72 : 1 }} glow={feedStatus === 'live'}>
        {/* sweep on refresh */}
        {active.fetchedAt != null && !reduced && (
          <div
            key={active.fetchedAt}
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
        {/* header */}
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
          {COLS.map((c) => headerCell(c.key, c.label))}
        </div>

        {feedStatus === 'error' && !rows.length ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <div style={{ fontFamily: F.display, fontSize: 13, letterSpacing: '0.1em', color: C.red }}>
              TLE UPLINK FAILED
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 11, color: C.inkDim, marginTop: 8 }}>
              {active.error ?? 'all proxy routes failed'} · SOURCE: CELESTRAK.ORG
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 11, color: C.inkFaint, marginTop: 4 }}>
              RETRIES AUTOMATICALLY ON THE 30-MIN CADENCE
            </div>
          </div>
        ) : isEmpty ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <div style={{ fontFamily: F.display, fontSize: 13, letterSpacing: '0.1em', color: C.inkDim }}>
              ACQUIRING ORBITAL ELEMENTS…
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 11, color: C.inkFaint, marginTop: 8 }}>
              FETCHING LIVE TLE SET FROM CELESTRAK
            </div>
          </div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', fontFamily: F.mono, fontSize: 12, color: C.inkDim }}>
            NO CATALOG ENTRIES MATCH “{query.toUpperCase()}”
          </div>
        ) : (
          <div
            ref={vw.ref}
            onScroll={(e) => vw.setScrollTop((e.target as HTMLDivElement).scrollTop)}
            className="wf-scroll"
            style={{ height: 560, overflowY: 'auto', position: 'relative' }}
          >
            <div style={{ height: vw.totalHeight, position: 'relative' }}>
              {sorted.slice(vw.start, vw.end + 1).map((r, i) => {
                const idx = vw.start + i
                const top = vw.rowOffset(idx)
                const expanded = idx === expandedIndex
                const lp = livePos[r.norad]
                const animateIn = firstPaintRef.current && idx < 20
                const rowBody = (
                  <div
                    onClick={() => setExpandedNorad(expanded ? null : r.norad)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: GRID,
                      gap: 8,
                      height: ROW_H,
                      alignItems: 'center',
                      padding: '0 14px',
                      cursor: 'pointer',
                      background: expanded ? C.bg3 : 'transparent',
                      borderLeft: expanded ? `2px solid ${C.cyan}` : '2px solid transparent',
                      fontFamily: F.mono,
                      fontSize: 13,
                      color: C.ink,
                      whiteSpace: 'nowrap',
                    }}
                    className="wf-rowhover wf-tabular"
                  >
                    <span style={{ color: C.inkDim }}>{r.norad}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      <LiveDot color={r.color} size={6} />
                      {r.name}
                    </span>
                    <span style={{ color: C.inkDim, fontSize: 11 }}>{r.groupLabel}</span>
                    <span>{Math.round(r.meanAltKm).toLocaleString()}</span>
                    <span>{r.velKmS.toFixed(2)}</span>
                    <span>{r.inclDeg.toFixed(1)}</span>
                    <span>{r.periodMin.toFixed(1)}</span>
                    <span className={lp?.flash ? 'wf-cellflash' : undefined} style={{ color: lp ? C.cyan : C.inkFaint }}>
                      {lp ? lp.lat.toFixed(2) : '···'}
                    </span>
                    <span className={lp?.flash ? 'wf-cellflash' : undefined} style={{ color: lp ? C.cyan : C.inkFaint }}>
                      {lp ? lp.lon.toFixed(2) : '···'}
                    </span>
                    <span style={{ color: C.inkFaint, fontSize: 11 }}>{epochAgeText(r.epochMs, now)}</span>
                  </div>
                )
                return (
                  <div key={r.norad} style={{ position: 'absolute', top, left: 0, right: 0 }}>
                    {animateIn && !reduced ? (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.02, duration: 0.3 }}>
                        {rowBody}
                      </motion.div>
                    ) : (
                      rowBody
                    )}
                    {expanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: EXPAND_H, opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 32 }}
                        style={{
                          overflow: 'hidden',
                          borderLeft: `2px solid ${C.cyan}`,
                          background: C.bg1,
                          padding: '0 14px',
                        }}
                      >
                        <div style={{ display: 'flex', gap: 24, padding: '12px 0', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ fontFamily: F.display, fontSize: 10, letterSpacing: '0.12em', color: C.inkFaint, marginBottom: 6 }}>
                              TWO-LINE ELEMENT SET · {r.intlDes || 'NO INTL DES'}
                            </div>
                            <pre
                              style={{
                                margin: 0,
                                fontFamily: F.mono,
                                fontSize: 10,
                                lineHeight: '15px',
                                color: C.inkDim,
                                background: C.bg0,
                                border: `1px solid ${C.line}`,
                                padding: '8px 10px',
                                overflowX: 'auto',
                              }}
                            >
                              {r.name}
                              {'\n'}
                              {r.line1}
                              {'\n'}
                              {r.line2}
                            </pre>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ fontFamily: F.mono, fontSize: 11, color: C.inkDim }}>
                              LIVE POS{' '}
                              <span style={{ color: C.cyan }}>
                                {lp ? `${lp.lat.toFixed(3)}° / ${lp.lon.toFixed(3)}° · ${Math.round(lp.altKm)} KM` : 'PROPAGATING…'}
                              </span>
                            </div>
                            <a
                              href={`/?focus=${r.norad}`}
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
                                width: 'fit-content',
                              }}
                            >
                              <Crosshair size={12} />
                              FLY TO ON GLOBE →
                            </a>
                            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.inkFaint }}>
                              SOURCE: CELESTRAK TLE · SGP4 PROPAGATED IN-BROWSER · {ageText(active.fetchedAt, now)} AGO
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {/* footer strip */}
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
            {sorted.length.toLocaleString()} OF {rows.length.toLocaleString()} ELEMENTS · SORT {sortKey.toUpperCase()}{' '}
            {sortAsc ? '▲' : '▼'}
          </span>
          <StatusChip
            status={feedStatus}
            label={`SOURCE: CELESTRAK${active.route ? ` VIA ${active.route}` : ''}`}
            age={`${ageText(active.fetchedAt, now)} AGO`}
          />
        </div>
      </HudPanel>
    </div>
  )
}
