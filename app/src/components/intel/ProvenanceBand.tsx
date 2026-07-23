/**
 * ProvenanceBand — intel.md §5. Three columns (GDELT / EONET / USGS)
 * with endpoint, cadence, live record count, ticking last-fetch age,
 * and status dot. Ages tick per second; dots use the status model.
 */

import { motion, useReducedMotion } from 'framer-motion';
import { derivedStatus, ageLabel, useSlice } from '@/store/useLiveStore';
import type { SourceKey } from '@/store/useLiveStore';
import { ENDPOINTS } from '@/lib/sources';
import { useNow } from './wire';

const DOT: Record<string, string> = {
  live: '#3DF58A',
  stale: '#FFB020',
  error: '#FF3B47',
  loading: '#5F7484',
  idle: '#3A4B59',
};

const COLS: Array<{ key: SourceKey; name: string; endpoint: string; cadence: string }> = [
  { key: 'news', name: 'GDELT DOC 2.0', endpoint: ENDPOINTS.gdeltDoc, cadence: '15M CACHE · 6S QUEUE' },
  { key: 'eonet', name: 'NASA EONET v3', endpoint: ENDPOINTS.eonet, cadence: 'POLL 10M' },
  { key: 'usgs', name: 'USGS GEOJSON', endpoint: ENDPOINTS.usgs, cadence: 'POLL 5M' },
];

function BandCol({ col, index }: { col: (typeof COLS)[number]; index: number }) {
  const slice = useSlice(col.key);
  const now = useNow();
  const reduce = useReducedMotion();
  const status = derivedStatus(slice, now);
  const color = DOT[status] ?? DOT.idle;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.4, delay: index * 0.08, ease: 'easeOut' }}
      className="border-t border-wf-line pt-3"
    >
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 rounded-full ${status === 'live' ? 'wf-anim-blink' : ''}`}
          style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
        />
        <span className="font-display text-[12px] font-semibold uppercase tracking-[0.1em] text-wf-ink">
          {col.name}
        </span>
      </div>
      <div className="mt-2 break-all font-data text-[10px] leading-4 text-wf-ink-faint">{col.endpoint}</div>
      <div className="mt-2 font-data text-[10px] uppercase tabular-nums text-wf-ink-dim">
        {col.cadence} · {slice.records.toLocaleString()} RECORDS · {ageLabel(slice.lastFetch, now)} AGO
      </div>
    </motion.div>
  );
}

export default function ProvenanceBand() {
  return (
    <section className="mt-16 border-t border-wf-line pt-8">
      <div className="grid gap-6 md:grid-cols-3">
        {COLS.map((c, i) => (
          <BandCol key={c.key} col={c} index={i} />
        ))}
      </div>
      <p className="mt-8 font-body text-xs leading-5 text-wf-ink-faint">
        ARTICLE GEOLOCATION IS COUNTRY-LEVEL AND APPROXIMATE · TONE IS GDELT-COMPUTED AT QUERY
        LEVEL (7D TIMELINETONE) · QUEUE RESPECTS THE GDELT 1 REQ / 5s LIMIT
      </p>
    </section>
  );
}
