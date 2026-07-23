/**
 * SourceCard — sources.md §2. Full-width HUD card, 12-col inner grid,
 * status-colored 2px left border. Live vitals tick each second; when a
 * real fetch completes while the page is open a cyan scan line sweeps
 * once (600ms). ERROR renders the actual message + retry countdown.
 */

import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, Copy } from 'lucide-react';
import HudFrame from '@/components/HudFrame';
import StatusChip from '@/components/StatusChip';
import { derivedStatus, ageLabel, useLiveState } from '@/store/useLiveStore';
import { useNow } from '@/components/intel/wire';
import { failures24h, useProbes } from './probes';
import type { RegistryEntry } from './registry';

const STATUS_COLORS: Record<string, string> = {
  live: '#3DF58A',
  stale: '#FFB020',
  error: '#FF3B47',
  loading: '#5F7484',
  idle: '#3A4B59',
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="flex items-center gap-1 border border-wf-line px-1.5 py-0.5 font-data text-[9px] uppercase text-wf-ink-faint opacity-0 transition-opacity duration-150 hover:text-wf-cyan group-hover:opacity-100"
      title="Copy endpoint"
    >
      {copied ? <Check className="h-3 w-3 text-wf-green" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function SourceCard({ entry, index }: { entry: RegistryEntry; index: number }) {
  const state = useLiveState();
  const probes = useProbes();
  const now = useNow();
  const reduce = useReducedMotion();

  const slice = entry.key ? state[entry.key] : null;
  const status = slice ? derivedStatus(slice, now) : 'live';
  const color = entry.key ? STATUS_COLORS[status] : '#5F7484';

  /* cyan sweep when a real fetch completes while the page is open */
  const prevFetch = useRef<number | null>(slice?.lastFetch ?? null);
  const [sweep, setSweep] = useState(0);
  useEffect(() => {
    const lf = slice?.lastFetch ?? null;
    if (prevFetch.current !== null && lf !== null && lf !== prevFetch.current) {
      setSweep((s) => s + 1);
      const t = window.setTimeout(() => setSweep(0), 650);
      return () => window.clearTimeout(t);
    }
    prevFetch.current = lf;
  }, [slice?.lastFetch]);

  const probe = entry.probe ? probes[entry.probe] : null;
  const fails = entry.key ? failures24h(entry.key) : 0;

  /* retry countdown: next scheduled poll after the failed attempt */
  const retryIn =
    slice && slice.status === 'error' && slice.pollMs > 0 && slice.lastAttempt
      ? Math.max(0, Math.round((slice.lastAttempt + slice.pollMs - now) / 1000))
      : null;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, delay: Math.min(index, 6) * 0.07, ease: 'easeOut' }}
    >
      <HudFrame className="group relative overflow-hidden p-4" style={{ borderLeft: `2px solid ${color}` }}>
        {/* scan sweep on real fetch completion */}
        {sweep > 0 && !reduce && (
          <motion.span
            key={sweep}
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-wf-cyan"
            initial={{ top: 0, opacity: 0.9 }}
            animate={{ top: '100%', opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeIn' }}
          />
        )}

        <div className="grid gap-4 md:grid-cols-12">
          {/* col 1 — identity */}
          <div className="md:col-span-3">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${status === 'live' && entry.key ? 'wf-anim-blink' : ''}`}
                style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
              />
              <span className="font-display text-[17px] font-semibold leading-[22px] tracking-[0.04em] text-wf-ink">
                {entry.name}
              </span>
            </div>
            <div className="mt-1.5 pl-4 font-display text-[10px] font-medium uppercase tracking-[0.14em] text-wf-ink-dim">
              {entry.role}
            </div>
          </div>

          {/* col 2 — endpoint */}
          <div className="md:col-span-4">
            <div className="flex items-start gap-2">
              <div className="min-w-0 break-all font-data text-[11px] leading-4 text-wf-ink-dim">{entry.endpoint}</div>
              <CopyButton text={entry.endpoint} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="border border-wf-line px-1.5 py-0.5 font-data text-[9px] uppercase tracking-[0.08em] text-wf-ink-dim">
                {entry.cadence}
              </span>
              {slice && (
                <span className="font-data text-[10px] tabular-nums text-wf-ink-faint">
                  {slice.records.toLocaleString()} RECORDS
                </span>
              )}
            </div>
          </div>

          {/* col 3 — integration notes */}
          <div className="md:col-span-3">
            <div className="font-display text-[10px] font-medium uppercase tracking-[0.14em] text-wf-ink-faint">
              Integration notes
            </div>
            <p className="mt-1 font-body text-xs leading-5 text-wf-ink-dim">{entry.notes}</p>
          </div>

          {/* col 4 — live vitals */}
          <div className="font-data text-[10px] uppercase tabular-nums md:col-span-2">
            <div className="flex justify-between gap-2">
              <span className="text-wf-ink-faint">Last fetch</span>
              <span className="text-wf-ink">{slice ? `${ageLabel(slice.lastFetch, now)} ago` : '——'}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-wf-ink-faint">Status</span>
              {slice ? (
                <StatusChip slice={slice} showAge={false} />
              ) : (
                <span className="text-wf-ink-dim">EXTERNAL</span>
              )}
            </div>
            <div className="mt-1.5 flex justify-between gap-2">
              <span className="text-wf-ink-faint">Latency</span>
              <motion.span
                key={probe?.at ?? 'none'}
                initial={reduce ? false : { opacity: 0.2 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.24 }}
                className="text-wf-ink"
                title={
                  entry.probe === 'news'
                    ? 'Measured from this browser — includes global GDELT queue wait'
                    : entry.probe === 'aircraft' && probe?.via
                      ? `Measured from this browser via ${probe.via}`
                      : 'Measured from this browser'
                }
              >
                {probe?.latencyMs != null ? `${probe.latencyMs.toLocaleString()}ms` : '——'}
              </motion.span>
            </div>
            <div className="mt-1.5 flex justify-between gap-2">
              <span className="text-wf-ink-faint" title="Real error transitions observed by this browser, rolling 24h">
                Failures 24h
              </span>
              <span className={fails > 0 ? 'text-wf-red' : 'text-wf-ink'}>{fails}</span>
            </div>
          </div>
        </div>

        {/* error banner — actual message + retry countdown */}
        {slice && slice.status === 'error' && (
          <div className="mt-3 border-t border-wf-red/30 pt-2">
            <span className="font-data text-[10px] uppercase text-wf-red">
              {slice.error ?? 'fetch failed'}
              {retryIn != null && ` · retrying in ${retryIn}s`}
            </span>
          </div>
        )}
      </HudFrame>
    </motion.div>
  );
}
