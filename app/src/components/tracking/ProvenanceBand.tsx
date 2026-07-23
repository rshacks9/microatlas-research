import { motion } from 'framer-motion'
import { C, F, HudPanel, LiveDot, ageText, statusColor, useNow } from './hud'
import type { FeedStatus } from './hud'

export interface ProvenanceEntry {
  name: string
  endpoint: string
  cadence: string
  status: FeedStatus
  records: number
  lastFetchMs: number | null
  note: string
  color: string
}

export default function ProvenanceBand({ entries }: { entries: ProvenanceEntry[] }) {
  const now = useNow(1000)
  return (
    <section style={{ marginTop: 64 }}>
      <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 32 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 8,
          }}
        >
          {entries.map((e, i) => (
            <motion.div
              key={e.name}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ delay: i * 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <HudPanel style={{ padding: 16, height: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <LiveDot color={e.color} size={7} />
                  <span style={{ fontFamily: F.display, fontWeight: 600, fontSize: 13, letterSpacing: '0.1em', color: C.ink }}>
                    {e.name}
                  </span>
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <LiveDot color={statusColor(e.status)} blink={e.status === 'live'} size={7} />
                    <span style={{ fontFamily: F.mono, fontSize: 10, color: statusColor(e.status) }}>
                      {e.status.toUpperCase()}
                    </span>
                  </span>
                </div>
                <div
                  style={{
                    marginTop: 10,
                    fontFamily: F.mono,
                    fontSize: 10,
                    color: C.inkFaint,
                    wordBreak: 'break-all',
                    lineHeight: '15px',
                  }}
                >
                  {e.endpoint}
                </div>
                <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  {[
                    ['CADENCE', e.cadence],
                    ['RECORDS', e.records.toLocaleString()],
                    ['LAST FETCH', `${ageText(e.lastFetchMs, now)} AGO`],
                    ['COVERAGE', e.note],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div style={{ fontFamily: F.display, fontSize: 9, letterSpacing: '0.12em', color: C.inkFaint }}>{k}</div>
                      <div className="wf-tabular" style={{ fontFamily: F.mono, fontSize: 11, color: C.inkDim, marginTop: 2 }}>
                        {v}
                      </div>
                    </div>
                  ))}
                </div>
              </HudPanel>
            </motion.div>
          ))}
        </div>
        <div
          style={{
            marginTop: 16,
            textAlign: 'center',
            fontFamily: F.mono,
            fontSize: 10,
            letterSpacing: '0.14em',
            color: C.inkFaint,
          }}
        >
          ALL POSITIONS COMPUTED OR FETCHED LIVE · NO HISTORIC REPLAY
        </div>
      </div>
    </section>
  )
}
