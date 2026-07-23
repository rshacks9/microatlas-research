/**
 * Intel Feed (/intel) — live GDELT DOC 2.0 news wire + natural events
 * (NASA EONET / USGS). Design: design/intel.md. No mock data: the wire
 * is a real artlist query through the global 6s GDELT queue; failures
 * render explicit ERROR/STALE states with the message retained.
 */

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import StatusChip from '@/components/StatusChip';
import HudFrame from '@/components/HudFrame';
import { useLiveState } from '@/store/useLiveStore';
import PageHead from '@/components/intel/PageHead';
import WireControls from '@/components/intel/WireControls';
import FeedCard from '@/components/intel/FeedCard';
import NaturalEvents from '@/components/intel/NaturalEvents';
import ProvenanceBand from '@/components/intel/ProvenanceBand';
import { useNow, useWireFeed } from '@/components/intel/wire';

function HeaderReadouts() {
  const state = useLiveState();
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-end gap-6">
        <div className="text-right">
          <div className="font-data text-[24px] font-bold leading-7 tabular-nums text-wf-ink">
            {state.news.records.toLocaleString()}
          </div>
          <div className="font-data text-[10px] uppercase tracking-[0.08em] text-wf-ink-faint">Articles</div>
        </div>
        <div className="text-right">
          <div className="font-data text-[24px] font-bold leading-7 tabular-nums text-wf-ink">
            {(state.eonet.records + state.usgs.records).toLocaleString()}
          </div>
          <div className="font-data text-[10px] uppercase tracking-[0.08em] text-wf-ink-faint">Events</div>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-x-4 gap-y-1">
        <StatusChip slice={state.news} label="GDELT" />
        <StatusChip slice={state.eonet} label="EONET" />
        <StatusChip slice={state.usgs} label="USGS" />
      </div>
    </div>
  );
}

export default function Intel() {
  const now = useNow();
  const reduce = useReducedMotion();
  const { state, active, sort, setPreset, search, setSort, loadMore } = useWireFeed();
  const stale = state.status === 'error' && state.articles.length > 0;

  return (
    <div className="mx-auto max-w-[1440px] px-6 pb-16">
      <PageHead
        eyebrow="Intel Feed"
        eyebrowDot="#D7E6EF"
        title="THE GLOBAL WIRE, LIVE"
        sub="Real articles indexed by GDELT within the last 24 hours, refreshed on a 15-minute cache, plus open natural events from NASA and the USGS. Tone and geolocation are source-derived; country-level pins are approximate."
        right={<HeaderReadouts />}
      />

      <WireControls
        active={active}
        queueBusy={state.queueBusy}
        tone={state.tone}
        sort={sort}
        onPreset={setPreset}
        onSearch={search}
        onSort={setSort}
      />

      {/* ---- article wire ---- */}
      <section className="mt-6">
        {state.status === 'error' && state.articles.length === 0 && (
          <HudFrame className="border-wf-red/40 p-6">
            <div className="font-data text-[12px] uppercase text-wf-red">
              Wire error — {state.error ?? 'unknown'}
            </div>
            <div className="mt-1 font-data text-[11px] text-wf-ink-faint">
              GDELT request failed; the queue retries on the next cycle. Query: {active.query}
            </div>
          </HudFrame>
        )}

        {(state.status === 'loading' || state.status === 'idle') && state.articles.length === 0 && (
          <HudFrame className="p-6">
            <div className="font-data text-[12px] uppercase text-wf-ink-dim">
              Acquiring GDELT wire<span className="wf-anim-blink">…</span>
            </div>
            <div className="mt-1 font-data text-[11px] text-wf-ink-faint">
              Request is serialized through the global 6s queue — first result lands shortly.
            </div>
          </HudFrame>
        )}

        {state.status === 'live' && state.articles.length === 0 && (
          <HudFrame className="p-6">
            <div className="font-data text-[12px] uppercase text-wf-ink-dim">
              No articles for query in 24h window
            </div>
            <div className="mt-1 break-all font-data text-[11px] text-wf-ink-faint">Query: {active.query}</div>
          </HudFrame>
        )}

        {state.articles.length > 0 && (
          <>
            {stale && (
              <div className="mb-3 flex items-center gap-2 font-data text-[10px] uppercase tracking-[0.08em] text-wf-amber">
                <span className="inline-block h-2 w-2 rounded-full bg-wf-amber" style={{ boxShadow: '0 0 6px #FFB020' }} />
                Stale — showing last good articles · {state.error ?? 'refresh failed'}
              </div>
            )}
            <div className="grid gap-2 min-[900px]:grid-cols-2">
              <AnimatePresence initial={false}>
                {state.articles.map((a, i) => (
                  <FeedCard key={a.url} article={a} tone={state.tone} fresh={state.fresh.has(a.url)} now={now} index={i} />
                ))}
              </AnimatePresence>
            </div>

            <div className="mt-6 flex justify-center">
              {state.endOfWindow ? (
                <div className="border border-wf-line px-4 py-2 font-data text-[11px] uppercase tracking-[0.08em] text-wf-ink-faint">
                  End of window — {state.articles.length} articles · 24h · GDELT
                </div>
              ) : (
                <motion.button
                  onClick={loadMore}
                  disabled={state.queueBusy}
                  whileTap={reduce ? undefined : { scale: 0.98 }}
                  className="border border-wf-line px-4 py-2 font-data text-[11px] uppercase tracking-[0.08em] text-wf-ink-dim transition-colors hover:border-wf-line-hi hover:text-wf-cyan disabled:cursor-wait disabled:opacity-60"
                >
                  {state.queueBusy ? 'Queued…' : `Load more · ${state.articles.length} shown`}
                </motion.button>
              )}
            </div>
          </>
        )}
      </section>

      <NaturalEvents />
      <ProvenanceBand />
    </div>
  );
}
