/**
 * ProvenanceDrawer — bottom sheet (320px) with one live status cell per
 * source family: dot, name, last-fetch age, cadence, records.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import HudFrame from '@/components/HudFrame';
import { useLiveState, ageLabel } from '@/store/useLiveStore';
import type { SourceKey } from '@/store/useLiveStore';

const CELLS: Array<{ key: SourceKey; name: string; cadence: string }> = [
  { key: 'tle', name: 'CelesTrak TLE', cadence: '30 MIN' },
  { key: 'aircraft', name: 'adsb.lol ADS-B', cadence: '12 S' },
  { key: 'ships', name: 'Digitraffic AIS', cadence: '30 S' },
  { key: 'news', name: 'GDELT DOC 2.0', cadence: '15 MIN' },
  { key: 'tension', name: 'Tension Engine', cadence: '15 MIN' },
  { key: 'eonet', name: 'NASA EONET', cadence: '10 MIN' },
  { key: 'usgs', name: 'USGS', cadence: '5 MIN' },
];

export default function ProvenanceDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useLiveState();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 bg-black/25"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: 320 }}
            animate={{ y: 0 }}
            exit={{ y: 320 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-x-0 bottom-8 z-50 mx-auto max-w-5xl px-3"
          >
            <HudFrame className="p-4">
              <div className="flex items-center justify-between">
                <span className="font-display text-[11px] font-medium uppercase tracking-[0.14em] text-wf-ink-dim">
                  Data Provenance // Live Status
                </span>
                <button onClick={onClose} className="text-wf-ink-dim hover:text-wf-ink" aria-label="Close provenance">
                  <X size={14} />
                </button>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                {CELLS.map(({ key, name, cadence }, i) => {
                  const s = state[key];
                  const dot = s.status === 'live' ? '#3DF58A' : s.status === 'error' ? '#FF3B47' : s.status === 'stale' ? '#FFB020' : '#3A4B59';
                  return (
                    <motion.div
                      key={key}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.04 * i, duration: 0.3 }}
                      className="border border-wf-line/60 px-2 py-2"
                      title={s.status === 'error' ? s.error ?? 'error' : name}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dot, boxShadow: `0 0 5px ${dot}` }} />
                        <span className="truncate font-display text-[11px] font-medium text-wf-ink">{name}</span>
                      </div>
                      <div className="mt-1.5 font-data text-[10px] tabular-nums text-wf-ink-dim">
                        {ageLabel(s.lastFetch, now)} ago
                      </div>
                      <div className="font-data text-[10px] text-wf-ink-faint">
                        {cadence} · {s.records.toLocaleString()} REC
                      </div>
                    </motion.div>
                  );
                })}
                {/* radio / SDR cell (on-demand, no poll) */}
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.04 * 7, duration: 0.3 }}
                  className="border border-wf-line/60 px-2 py-2"
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: state.radio.data.nowPlaying ? '#3DF58A' : '#3A4B59' }}
                    />
                    <span className="truncate font-display text-[11px] font-medium text-wf-ink">LiveATC / SDR</span>
                  </div>
                  <div className="mt-1.5 font-data text-[10px] text-wf-ink-dim">
                    {state.radio.data.nowPlaying ? 'STREAMING' : 'ON DEMAND'}
                  </div>
                  <div className="font-data text-[10px] text-wf-ink-faint">ON PLAY</div>
                </motion.div>
              </div>

              <div className="mt-3 flex items-center justify-between font-data text-[10px] text-wf-ink-faint">
                <span>ALL DATA FETCHED LIVE FROM PUBLIC SOURCES AT VIEW TIME · NO SYNTHETIC DATA</span>
                <Link to="/sources" className="text-wf-cyan hover:underline">
                  FULL REGISTRY →
                </Link>
              </div>
            </HudFrame>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
