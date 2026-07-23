/**
 * FreshnessBand (conflicts.md §6) — transparent per-zone fetch table for
 * the page's GDELT artlist queries: ZONE QUERY · LAST FETCH · ARTICLES ·
 * STATUS. Ages tick every second. Exposes the shared queue's 6s spacing
 * and 15-min cache instead of hiding them.
 */

import { motion } from 'framer-motion';
import { CONFLICT_ZONES } from '@/lib/zones';
import { ageLabel } from '@/store/useLiveStore';
import { useCoverageMap } from './coverageStore';

const DOT: Record<string, string> = {
  live: '#3DF58A',
  loading: '#5F7484',
  error: '#FF3B47',
  idle: '#3A4B59',
};

export default function FreshnessBand({ now }: { now: number }) {
  const coverage = useCoverageMap();

  return (
    <section className="mt-16 border-t border-wf-line pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[11px] font-medium uppercase tracking-[0.14em] text-wf-ink-dim">
          GDELT query freshness <span className="text-wf-ink-faint">// this page</span>
        </h2>
        <span className="font-body text-[12px] text-wf-ink-faint">
          GDELT RATE LIMIT: 1 REQ / 5s · QUEUE SPACING 6s · RESPONSE CACHE 15 MIN
        </span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse font-data text-[11px]">
          <thead>
            <tr className="border-b border-wf-line text-left text-[9px] uppercase tracking-[0.14em] text-wf-ink-faint">
              <th className="py-2 pr-4 font-medium">Zone query</th>
              <th className="py-2 pr-4 font-medium">Last fetch</th>
              <th className="py-2 pr-4 font-medium">Articles</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {CONFLICT_ZONES.map((z, i) => {
              const c = coverage[z.id];
              const status = c?.status ?? 'idle';
              return (
                <motion.tr
                  key={z.id}
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.9) }}
                  className="border-b border-wf-line/50 text-wf-ink-dim"
                >
                  <td className="max-w-[380px] truncate py-1.5 pr-4" title={z.gdeltQuery}>
                    <span className="text-wf-ink">{z.name}</span>
                    <span className="ml-2 text-wf-ink-faint">{z.gdeltQuery}</span>
                  </td>
                  <td className="py-1.5 pr-4 tabular-nums">{ageLabel(c?.lastFetch ?? null, now)}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{status === 'live' ? (c?.articles.length ?? 0) : '—'}</td>
                  <td className="py-1.5">
                    <span className="inline-flex items-center gap-1.5 uppercase">
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${status === 'live' ? 'wf-anim-blink' : ''}`}
                        style={{ backgroundColor: DOT[status] }}
                      />
                      <span style={{ color: DOT[status] }}>
                        {status === 'live' ? 'LIVE' : status === 'loading' ? 'QUEUED' : status === 'error' ? 'ERROR' : 'IDLE'}
                      </span>
                      {status === 'error' && c?.error && (
                        <span className="max-w-[220px] truncate normal-case text-wf-ink-faint" title={c.error}>
                          — {c.error}
                        </span>
                      )}
                    </span>
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
