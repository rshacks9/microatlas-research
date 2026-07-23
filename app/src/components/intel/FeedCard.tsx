/**
 * FeedCard — one real GDELT article row (intel.md §3).
 * 2px tone bar (query-level timelinetone, labeled), source-country chip,
 * domain, 2-line clamped title linking out, SEEN timestamp, APPROX GEO
 * tag, hover actions OPEN ↗ / PIN ON GLOBE →.
 */

import { memo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ExternalLink, MapPin } from 'lucide-react';
import HudFrame from '@/components/HudFrame';
import { relLabel, toneColor } from './wire';
import type { WireArticle } from './wire';

function FeedCard({
  article,
  tone,
  fresh,
  now,
  index,
}: {
  article: WireArticle;
  tone: number | null;
  fresh: boolean;
  now: number;
  index: number;
}) {
  const reduce = useReducedMotion();
  const tc = toneColor(tone);

  return (
    <motion.div
      layout="position"
      initial={reduce ? false : { opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.4, delay: Math.min(index, 8) * 0.05, ease: 'easeOut' }}
    >
      <motion.div
        animate={fresh && !reduce ? { backgroundColor: ['rgba(16,26,37,1)', 'rgba(16,26,37,0)'] } : undefined}
        transition={{ duration: 0.8 }}
      >
        <HudFrame className="group p-0 transition-all duration-150 hover:-translate-y-0.5 hover:border-wf-line-hi">
          <div className="flex">
            {/* tone bar — query-level GDELT timelinetone */}
            <span
              className="w-[2px] shrink-0 transition-all duration-150 group-hover:w-[3px]"
              style={{ backgroundColor: tc }}
              title={tone != null ? `TONE ${tone > 0 ? '+' : ''}${tone.toFixed(2)} · GDELT TIMELINETONE · QUERY-LEVEL (7D)` : 'TONE —— · GDELT'}
            />

            <div className="min-w-0 flex-1 p-3">
              <div className="flex items-center gap-2">
                <span
                  className="shrink-0 border border-wf-line px-1 font-data text-[9px] uppercase tracking-[0.08em] text-wf-ink-dim"
                  title={article.sourcecountry || 'Unknown source country'}
                >
                  {article.code}
                </span>
                <span className="truncate font-data text-[10px] text-wf-ink-faint">{article.domain}</span>
                <span className="flex-1" />
                <span className="shrink-0 font-data text-[10px] uppercase tabular-nums text-wf-ink-faint">
                  SEEN {relLabel(article.seenMs, now)}
                </span>
              </div>

              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 line-clamp-2 block font-display text-[15px] font-medium leading-5 text-wf-ink transition-colors hover:text-wf-cyan"
              >
                {article.title}
              </a>

              <div className="mt-2 flex items-center gap-2">
                <span
                  className="border px-1 py-px font-data text-[9px] uppercase tabular-nums"
                  style={{ color: tc, borderColor: 'var(--line)' }}
                >
                  TONE {tone != null ? (tone > 0 ? `+${tone.toFixed(1)}` : tone.toFixed(1)) : '——'}
                </span>
                {article.hasGeo && (
                  <span
                    className="border border-wf-line px-1 py-px font-data text-[9px] uppercase text-wf-ink-faint"
                    title="Country-level centroid — approximate, labeled"
                  >
                    APPROX GEO
                  </span>
                )}
                <span className="flex-1" />
                <span className="flex items-center gap-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 font-data text-[10px] uppercase text-wf-cyan hover:underline"
                  >
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                  <a
                    href={`/?news=${article.hash}`}
                    className="flex items-center gap-1 font-data text-[10px] uppercase text-wf-ink-dim hover:text-wf-cyan"
                    title="Focus this article's approximate country pin on the deck globe"
                  >
                    Pin on globe <MapPin className="h-3 w-3" />
                  </a>
                </span>
              </div>
            </div>
          </div>
        </HudFrame>
      </motion.div>
    </motion.div>
  );
}

export default memo(FeedCard);
