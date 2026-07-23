import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Anchor, Crosshair, Search } from 'lucide-react'
import { C, F, HudPanel, LiveDot, StatusChip, ageText, useNow } from './hud'
import type { ShipRow, ShipsFeed } from './useShips'

const ROW_H = 34
const EXPAND_H = 108
const GRID = '110px minmax(140px,1fr) 84px 84px 90px 96px 110px'

type SortKey = 'mmsi' | 'name' | 'sog' | 'cog' | 'lat' | 'lon' | 'age'
const COLS: { key: SortKey; label: string }[] = [
  { key: 'mmsi', label: 'MMSI' },
  { key: 'name', label: 'NAME' },
  { key: 'sog', label: 'SOG KN' },
  { key: 'cog', label: 'COG°' },
  { key: 'lat', label: 'LAT' },
  { key: 'lon', label: 'LON' },
  { key: 'age', label: 'LAST AIS' },
]

function utcTime(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`
}

export default function ShipsPanel({ feed }: { feed: ShipsFeed }) {
  const now = useNow(1000)
  const [sortKey, setSortKey] = useState<SortKey>('mmsi')
  const [sortAsc, setSortAsc] = useState(true)
  const [expandedMmsi, setExpandedMmsi] = useState<number | null>(null)
  const [keyDraft, setKeyDraft] = useState('')

  const sorted = useMemo(() => {
    const arr = [...feed.filteredRows]
    const dir = sortAsc ? 1 : -1
    const val = (r: ShipRow): number | string => {
      switch (sortKey) {
        case 'mmsi':
          return r.mmsi
        case 'name':
          return r.name || '~~~'
        case 'sog':
          return r.sog ?? -1
        case 'cog':
          return r.cog ?? -1
        case 'lat':
          return r.lat
        case 'lon':
          return r.lon
        case 'age':
          return r.tsMs
      }
    }
    arr.sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb)) * dir
      return (va - vb) * dir
    })
    return arr
  }, [feed.filteredRows, sortKey, sortAsc])

  const [scrollTop, setScrollTop] = useState(0)
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 8)
  const end = Math.min(sorted.length - 1, Math.ceil((scrollTop + 560) / ROW_H) + 8)
  const expandedIndex = expandedMmsi != null ? sorted.findIndex((r) => r.mmsi === expandedMmsi) : -1
  const expH = expandedIndex >= 0 ? EXPAND_H : 0
  const rowOffset = (i: number) => i * ROW_H + (expandedIndex >= 0 && i > expandedIndex ? expH : 0)
  const totalHeight = sorted.length * ROW_H + expH

  const aisstreamChip =
    feed.aisstreamState === 'off'
      ? null
      : {
          color: feed.aisstreamState === 'live' ? C.green : feed.aisstreamState === 'error' ? C.red : C.amber,
          text:
            feed.aisstreamState === 'live'
              ? `GLOBAL AIS · LIVE · ${feed.aisstreamCount.toLocaleString()} VESSELS`
              : feed.aisstreamState === 'connecting'
                ? 'GLOBAL AIS · CONNECTING…'
                : 'GLOBAL AIS · SOCKET ERROR — CHECK KEY',
        }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Coverage banner */}
      {!feed.aisstreamKey && (
        <motion.div layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
          <HudPanel accent={C.blue} style={{ padding: 16, borderLeft: `3px solid ${C.blue}` }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <Anchor size={16} color={C.blue} style={{ marginTop: 2, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ fontFamily: F.display, fontWeight: 600, fontSize: 12, letterSpacing: '0.1em', color: C.blue }}>
                  AIS COVERAGE: FINNISH / BALTIC WATERS — LIVE VIA DIGITRAFFIC
                </div>
                <div style={{ fontFamily: F.body, fontSize: 12, color: C.inkDim, marginTop: 4 }}>
                  Global feed available with an AISSTREAM key (see Sources). Without a key the app remains fully functional
                  on Digitraffic.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder="AISSTREAM API KEY"
                  style={{
                    background: C.bg1,
                    border: `1px solid ${C.line}`,
                    outline: 'none',
                    color: C.ink,
                    fontFamily: F.mono,
                    fontSize: 11,
                    height: 32,
                    padding: '0 10px',
                    width: 220,
                  }}
                />
                <button
                  onClick={() => {
                    feed.saveAisstreamKey(keyDraft)
                    setKeyDraft('')
                  }}
                  disabled={!keyDraft.trim()}
                  style={{
                    height: 32,
                    padding: '0 14px',
                    border: `1px solid ${C.blue}`,
                    background: 'rgba(78,168,255,0.08)',
                    color: C.blue,
                    cursor: keyDraft.trim() ? 'pointer' : 'default',
                    opacity: keyDraft.trim() ? 1 : 0.4,
                    fontFamily: F.display,
                    fontWeight: 600,
                    fontSize: 10,
                    letterSpacing: '0.12em',
                  }}
                >
                  CONNECT
                </button>
              </div>
            </div>
          </HudPanel>
        </motion.div>
      )}

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
              placeholder="MMSI / NAME"
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
          {aisstreamChip && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                border: `1px solid ${aisstreamChip.color}55`,
                padding: '6px 12px',
                fontFamily: F.mono,
                fontSize: 11,
                color: aisstreamChip.color,
              }}
            >
              <LiveDot color={aisstreamChip.color} blink={feed.aisstreamState !== 'error'} size={7} />
              {aisstreamChip.text}
              <button
                onClick={feed.clearAisstreamKey}
                style={{
                  background: 'none',
                  border: 'none',
                  color: C.inkFaint,
                  cursor: 'pointer',
                  fontFamily: F.mono,
                  fontSize: 10,
                  textDecoration: 'underline',
                }}
              >
                DISCONNECT
              </button>
            </span>
          )}
          <div style={{ marginLeft: 'auto' }}>
            <StatusChip status={feed.status} label="FEED: DIGITRAFFIC AIS" age={`${ageText(feed.lastFetchMs, now)} AGO`} />
          </div>
        </div>
      </HudPanel>

      {/* Stat strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
        {[
          { label: 'VESSELS', value: feed.count.toLocaleString(), color: C.blue },
          { label: 'AVG SOG', value: feed.avgSog != null ? `${feed.avgSog.toFixed(1)} KN` : '—', color: C.ink },
          { label: 'DATA UPDATED', value: feed.feedUpdatedMs ? utcTime(feed.feedUpdatedMs) : '—', color: C.ink },
          {
            label: 'FEED STATUS',
            value: feed.status.toUpperCase(),
            color: feed.status === 'live' ? C.green : feed.status === 'error' ? C.red : C.amber,
          },
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

      {/* Table */}
      <HudPanel style={{ overflow: 'hidden' }} glow={feed.status === 'live'}>
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
                color: sortKey === c.key ? C.blue : C.inkFaint,
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
              {feed.status === 'error' ? 'AIS FEED OFFLINE' : feed.query ? 'NO VESSELS MATCH QUERY' : 'ACQUIRING AIS BEACONS…'}
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 11, color: C.inkFaint, marginTop: 8 }}>
              {feed.status === 'error'
                ? feed.error ?? 'fetch failed'
                : 'POLLING DIGITRAFFIC MERI API — 30s CADENCE · BALTIC COVERAGE'}
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
                return (
                  <div key={`${r.src}-${r.mmsi}`} style={{ position: 'absolute', top: rowOffset(idx), left: 0, right: 0 }}>
                    <div
                      onClick={() => setExpandedMmsi(expanded ? null : r.mmsi)}
                      className="wf-rowhover wf-tabular"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: GRID,
                        gap: 8,
                        height: ROW_H,
                        alignItems: 'center',
                        padding: '0 14px',
                        cursor: 'pointer',
                        background: expanded ? C.bg3 : 'transparent',
                        borderLeft: expanded ? `2px solid ${C.blue}` : '2px solid transparent',
                        fontFamily: F.mono,
                        fontSize: 13,
                        color: C.ink,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span style={{ color: C.inkDim }}>{r.mmsi}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 7 }}>
                        <LiveDot color={r.src === 'aisstream' ? C.green : C.blue} size={6} />
                        {r.name || <span style={{ color: C.inkFaint }}>—</span>}
                      </span>
                      <span>{r.sog != null ? r.sog.toFixed(1) : '—'}</span>
                      <span>{r.cog != null ? Math.round(r.cog) : '—'}</span>
                      <span style={{ color: C.inkDim }}>{r.lat.toFixed(3)}</span>
                      <span style={{ color: C.inkDim }}>{r.lon.toFixed(3)}</span>
                      <span style={{ color: C.inkFaint, fontSize: 11 }}>{utcTime(r.tsMs)}</span>
                    </div>
                    {expanded && (
                      <div
                        style={{
                          height: EXPAND_H,
                          overflow: 'hidden',
                          borderLeft: `2px solid ${C.blue}`,
                          background: C.bg1,
                          padding: '12px 14px',
                          display: 'flex',
                          gap: 24,
                          flexWrap: 'wrap',
                          alignItems: 'flex-start',
                        }}
                      >
                        <div style={{ fontFamily: F.mono, fontSize: 11, color: C.inkDim, lineHeight: '18px' }}>
                          <div>
                            HDG <span style={{ color: C.ink }}>{r.hdg != null ? `${r.hdg}°` : '—'}</span> · NAVSTAT{' '}
                            <span style={{ color: C.ink }}>{r.navStat != null ? r.navStat : '—'}</span> · SRC{' '}
                            <span style={{ color: r.src === 'aisstream' ? C.green : C.blue }}>
                              {r.src === 'aisstream' ? 'AISSTREAM GLOBAL' : 'DIGITRAFFIC BALTIC'}
                            </span>
                          </div>
                          <div style={{ color: C.inkFaint, fontSize: 10 }}>
                            LAST AIS {utcTime(r.tsMs)} · {ageText(r.tsMs, now)} OLD
                          </div>
                        </div>
                        <a
                          href={`/?focus=ship-${r.mmsi}`}
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
            {sorted.length.toLocaleString()} SHOWN · {feed.count.toLocaleString()} VESSELS · SORT {sortKey.toUpperCase()}{' '}
            {sortAsc ? '▲' : '▼'}
          </span>
          <StatusChip status={feed.status} label="SOURCE: MERI.DIGITRAFFIC.FI" age={`${ageText(feed.lastFetchMs, now)} AGO`} />
        </div>
      </HudPanel>
    </div>
  )
}
