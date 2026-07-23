import { useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { C, F, Eyebrow, LiveDot, StatusChip, TrackingKeyframes, ageText, useCountUp, useNow, usePrefersReducedMotion } from '@/components/tracking/hud'
import { useSatellites } from '@/components/tracking/useSatellites'
import { useAircraft } from '@/components/tracking/useAircraft'
import { useShips } from '@/components/tracking/useShips'
import SatellitesPanel from '@/components/tracking/SatellitesPanel'
import AircraftPanel from '@/components/tracking/AircraftPanel'
import ShipsPanel from '@/components/tracking/ShipsPanel'
import ProvenanceBand from '@/components/tracking/ProvenanceBand'
import type { ProvenanceEntry } from '@/components/tracking/ProvenanceBand'

type TabId = 'satellites' | 'aircraft' | 'ships'

const H1 = 'EVERY TRACKED OBJECT, LIVE'

function HeaderStat({
  label,
  value,
  color,
  chip,
}: {
  label: string
  value: number
  color: string
  chip: ReactNode
}) {
  const display = useCountUp(value, 800)
  return (
    <div style={{ minWidth: 170 }}>
      <div style={{ fontFamily: F.display, fontSize: 10, letterSpacing: '0.14em', color: C.inkFaint }}>{label}</div>
      <div
        className="wf-tabular"
        style={{
          fontFamily: F.mono,
          fontWeight: 700,
          fontSize: 24,
          lineHeight: '28px',
          color,
          textShadow: `0 0 12px ${color}44`,
          marginTop: 4,
        }}
      >
        {display.toLocaleString()}
      </div>
      <div style={{ marginTop: 4 }}>{chip}</div>
    </div>
  )
}

export default function Tracking() {
  const now = useNow(1000)
  const reduced = usePrefersReducedMotion()
  const sats = useSatellites()
  const aircraft = useAircraft(now)
  const ships = useShips()
  const [tab, setTab] = useState<TabId>('satellites')

  const tabs: { id: TabId; label: string; color: string; count: number }[] = [
    { id: 'satellites', label: 'SATELLITES', color: C.cyan, count: sats.totalUnique },
    { id: 'aircraft', label: 'AIRCRAFT', color: C.amber, count: aircraft.count },
    { id: 'ships', label: 'SHIPS', color: C.blue, count: ships.count },
  ]

  const provenance: ProvenanceEntry[] = [
    {
      name: 'CELESTRAK TLE',
      endpoint: 'celestrak.org/NORAD/elements/gp.php?GROUP=…&FORMAT=TLE',
      cadence: '30 MIN',
      status: sats.anyLive ? sats.active.status : sats.active.status,
      records: sats.totalUnique,
      lastFetchMs: sats.latestFetch,
      note: 'GLOBAL ORBITAL CATALOG',
      color: C.cyan,
    },
    {
      name: 'ADSB.LOL v2',
      endpoint: 'api.adsb.lol/v2/lat/…/lon/…/dist/250 (14-region hotspot grid, CORS proxy chain)',
      cadence: '10–15 S CYCLE',
      status: aircraft.status,
      records: aircraft.count,
      lastFetchMs: aircraft.lastPollMs,
      note: 'RECEIVER GRID · HOTSPOTS',
      color: C.amber,
    },
    {
      name: 'DIGITRAFFIC AIS',
      endpoint: 'meri.digitraffic.fi/api/ais/v1/locations',
      cadence: '30 S',
      status: ships.status,
      records: ships.count,
      lastFetchMs: ships.lastFetchMs,
      note: ships.aisstreamState === 'live' ? 'BALTIC + AISSTREAM GLOBAL' : 'FINNISH / BALTIC WATERS',
      color: C.blue,
    },
  ]

  return (
    <div style={{ background: C.bg0, minHeight: '100dvh', color: C.ink, fontFamily: F.body }}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap"
        rel="stylesheet"
      />
      <TrackingKeyframes />

      <div style={{ maxWidth: 1440, margin: '0 auto', padding: '64px 24px 96px' }}>
        {/* Section 1 — Page header */}
        <header>
          <motion.div
            initial={reduced ? false : { opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <Eyebrow text="ORBIT & TRAFFIC" />
          </motion.div>
          <h1
            aria-label={H1}
            style={{
              fontFamily: F.display,
              fontWeight: 700,
              fontSize: 'clamp(26px, 4vw, 40px)',
              lineHeight: 1.1,
              letterSpacing: '0.08em',
              color: C.ink,
              margin: '16px 0 0',
              textTransform: 'uppercase',
            }}
          >
            {H1.split('').map((ch, i) => (
              <motion.span
                key={i}
                aria-hidden
                style={{ display: 'inline-block', whiteSpace: 'pre' }}
                initial={reduced ? false : { opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 20) * 0.015, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              >
                {ch}
              </motion.span>
            ))}
          </h1>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-end', marginTop: 16 }}>
            <motion.p
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.5 }}
              style={{ maxWidth: 640, margin: 0, fontSize: 14, lineHeight: '20px', color: C.inkDim, flex: '1 1 420px' }}
            >
              Real orbital elements propagated in your browser, real transponder pings from ground receivers, real AIS
              beacons. Nothing simulated.
            </motion.p>
            <motion.div
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.5 }}
              style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}
            >
              <HeaderStat
                label="OBJECTS IN ORBIT"
                value={sats.totalUnique}
                color={C.cyan}
                chip={<StatusChip status={sats.active.status} label="SOURCE: CELESTRAK" age={`${ageText(sats.latestFetch, now)} AGO`} />}
              />
              <HeaderStat
                label="AIRCRAFT TRACKED"
                value={aircraft.count}
                color={C.amber}
                chip={<StatusChip status={aircraft.status} label="SOURCE: ADSB.LOL" age={`${ageText(aircraft.lastPollMs, now)} AGO`} />}
              />
              <HeaderStat
                label="VESSELS"
                value={ships.count}
                color={C.blue}
                chip={<StatusChip status={ships.status} label="SOURCE: DIGITRAFFIC" age={`${ageText(ships.lastFetchMs, now)} AGO`} />}
              />
            </motion.div>
          </div>
        </header>

        {/* Section 2 — Tab bar */}
        <div
          role="tablist"
          aria-label="Tracking catalogs"
          style={{
            display: 'flex',
            gap: 4,
            marginTop: 48,
            borderBottom: `1px solid ${C.line}`,
            position: 'sticky',
            top: 0,
            zIndex: 20,
            background: `${C.bg0}F2`,
          }}
        >
          {tabs.map((t) => {
            const on = tab === t.id
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.id)}
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 20px',
                  background: on ? C.bg3 : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: F.display,
                  fontWeight: 600,
                  fontSize: 13,
                  letterSpacing: '0.1em',
                  color: on ? C.ink : C.inkDim,
                }}
              >
                <LiveDot color={t.color} size={7} blink={on} />
                {t.label}
                <span className="wf-tabular" style={{ fontFamily: F.mono, fontSize: 11, color: on ? t.color : C.inkFaint }}>
                  {t.count.toLocaleString()}
                </span>
                {on && (
                  <motion.span
                    layoutId="wf-tab-underline"
                    transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 32 }}
                    style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, background: t.color }}
                  />
                )}
              </button>
            )
          })}
          <div style={{ marginLeft: 'auto', alignSelf: 'center', fontFamily: F.mono, fontSize: 10, color: C.inkFaint }}>
            UTC {new Date(now).toISOString().substring(11, 19)}
          </div>
        </div>

        {/* Sections 3–5 — Panels (kept mounted to preserve table state; crossfade on switch) */}
        <div style={{ marginTop: 24 }}>
          {tabs.map((t) => (
            <div key={t.id} role="tabpanel" style={{ display: tab === t.id ? 'block' : 'none' }}>
              {tab === t.id ? (
                <motion.div
                  initial={reduced ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                >
                  {t.id === 'satellites' && (
                    <SatellitesPanel
                      active={sats.active}
                      activeGroup={sats.activeGroup}
                      selectGroup={sats.selectGroup}
                      groupCounts={sats.groupCounts}
                    />
                  )}
                  {t.id === 'aircraft' && <AircraftPanel feed={aircraft} />}
                  {t.id === 'ships' && <ShipsPanel feed={ships} />}
                </motion.div>
              ) : null}
            </div>
          ))}
        </div>

        {/* Section 6 — Provenance band */}
        <ProvenanceBand entries={provenance} />
      </div>
    </div>
  )
}
