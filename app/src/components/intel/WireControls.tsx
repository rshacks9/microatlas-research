/**
 * WireControls — sticky-under-TopBar control strip (intel.md §2).
 * Topic preset chips (each a real GDELT query), free-text search that
 * runs through the global 6s queue with a visible QUEUED state, sort
 * toggle, and the rate-limit honesty chip with a live queue dot.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Search } from 'lucide-react';
import HudFrame from '@/components/HudFrame';
import { TOPIC_PRESETS, toneColor } from './wire';
import type { TopicPreset, WireSort } from './wire';

export default function WireControls({
  active,
  queueBusy,
  tone,
  sort,
  onPreset,
  onSearch,
  onSort,
}: {
  active: TopicPreset;
  queueBusy: boolean;
  tone: number | null;
  sort: WireSort;
  onPreset: (p: TopicPreset) => void;
  onSearch: (text: string) => void;
  onSort: (s: WireSort) => void;
}) {
  const reduce = useReducedMotion();
  const [text, setText] = useState('');
  const [pulse, setPulse] = useState(0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSearch(text);
    setPulse((p) => p + 1);
    setText('');
  };

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="sticky top-14 z-40 mt-10"
    >
      <HudFrame className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* topic preset chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            {TOPIC_PRESETS.map((p) => {
              const isActive = active.id === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => onPreset(p)}
                  title={`GDELT query: ${p.query}`}
                  className={`relative overflow-hidden border px-2.5 py-1 font-data text-[10px] uppercase tracking-[0.08em] transition-colors duration-150 ${
                    isActive
                      ? 'border-wf-cyan/50 text-wf-cyan'
                      : 'border-wf-line text-wf-ink-dim hover:border-wf-line-hi hover:text-wf-ink'
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="wf-chip-fill"
                      className="absolute inset-0 bg-wf-cyan/10"
                      transition={reduce ? { duration: 0 } : { duration: 0.15, ease: 'easeOut' }}
                    />
                  )}
                  <span className="relative">{p.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex-1" />

          {/* free-text search — real GDELT query through the 6s queue */}
          <form onSubmit={submit} className="relative flex items-center">
            <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-wf-ink-faint" />
            <motion.input
              key={pulse}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="SEARCH GDELT…"
              animate={pulse > 0 && !reduce ? { borderColor: ['#2EE6C8', '#182635'] } : undefined}
              transition={{ duration: 0.6 }}
              className="w-44 border border-wf-line bg-bg-1 py-1.5 pl-7 pr-2 font-data text-[11px] uppercase tracking-[0.06em] text-wf-ink placeholder:text-wf-ink-faint focus:border-wf-cyan/60 focus:outline-none sm:w-56"
            />
          </form>

          {/* sort toggle */}
          <div className="flex border border-wf-line">
            {(
              [
                ['hybridrel', 'HYBRID RELEVANCE'],
                ['datedesc', 'NEWEST'],
              ] as Array<[WireSort, string]>
            ).map(([v, label]) => (
              <button
                key={v}
                onClick={() => onSort(v)}
                className={`px-2.5 py-1.5 font-data text-[10px] uppercase tracking-[0.06em] transition-colors duration-150 ${
                  sort === v ? 'bg-bg-3 text-wf-cyan' : 'text-wf-ink-faint hover:text-wf-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* rate-limit honesty chip + queue dot */}
          <div
            className="flex items-center gap-2 border border-wf-line px-2.5 py-1.5"
            title="All GDELT requests are serialized globally with ≥6s spacing and a 15-minute cache"
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${queueBusy ? 'wf-anim-blink' : ''}`}
              style={{
                backgroundColor: queueBusy ? '#FFB020' : '#3DF58A',
                boxShadow: `0 0 6px ${queueBusy ? '#FFB020' : '#3DF58A'}`,
              }}
            />
            <span className="font-data text-[10px] uppercase tracking-[0.06em] text-wf-ink-dim">
              {queueBusy ? 'QUEUED…' : 'GDELT QUEUE · 1 REQ / 5s'}
            </span>
          </div>

          {/* query-level tone readout (real timelinetone 7d latest) */}
          <div
            className="flex items-center gap-2 border border-wf-line px-2.5 py-1.5"
            title="Latest timelinetone value for the active query (GDELT, 7-day window) — query-level, not per-article"
          >
            <span className="font-data text-[10px] uppercase text-wf-ink-faint">Query tone</span>
            <span className="font-data text-[11px] font-bold tabular-nums" style={{ color: toneColor(tone) }}>
              {tone != null ? (tone > 0 ? `+${tone.toFixed(2)}` : tone.toFixed(2)) : '——'}
            </span>
          </div>
        </div>

        {/* active query echo */}
        <div className="mt-2 truncate font-data text-[10px] text-wf-ink-faint">
          <span className="text-wf-ink-dim">QUERY ›</span> {active.query}
        </div>
      </HudFrame>
    </motion.div>
  );
}
