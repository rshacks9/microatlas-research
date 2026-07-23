import { memo } from 'react';
import { motion } from 'framer-motion';
import { ExternalLink, Play, RotateCcw, Square } from 'lucide-react';
import HudFrame from './HudFrame';
import EqBars from './EqBars';
import { useRadio } from './RadioContext';
import { liveatcPageUrl } from './signalsData';
import type { AtcFeed } from './signalsData';
import { cn } from '@/lib/utils';

const CHAKRA = "'Chakra Petch', sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";

function AudioCardInner({ feed, index }: { feed: AtcFeed; index: number }) {
  const { active, status, play, stop, retry } = useRadio();
  const isActive = active?.id === feed.id;
  const isLive = isActive && status === 'live';
  const isConnecting = isActive && status === 'connecting';
  const isError = isActive && status === 'error';

  const onToggle = () => {
    if (isActive && (isLive || isConnecting)) stop();
    else play(feed);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, delay: (index % 6) * 0.06, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -2 }}
    >
      <HudFrame
        glow={isActive && !isError}
        bracketColor={isError ? '#FF3B4788' : isActive ? '#2EE6C8' : '#2EE6C855'}
        className={cn(
          'p-4 transition-colors duration-150',
          isActive && !isError && 'border-[#2EE6C866]',
          isError && 'wf-errflash border-[#FF3B4766]',
          !isActive && 'hover:border-[#2EE6C833]',
        )}
      >
        {/* top row: feed id + status */}
        <div className="flex items-start justify-between gap-2">
          <span className="text-[14px] font-semibold tracking-[0.08em] text-[#D7E6EF]" style={{ fontFamily: CHAKRA }}>
            {feed.label}
          </span>
          {isError ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#FF3B47]" style={{ boxShadow: '0 0 8px #FF3B47' }} />
              <span className="font-mono text-[10px] tracking-[0.14em] text-[#FF3B47]" style={{ fontFamily: MONO }}>
                STREAM ERROR
              </span>
            </span>
          ) : isConnecting ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="wf-blink h-2 w-2 rounded-full bg-[#FFB020]" style={{ boxShadow: '0 0 8px #FFB020' }} />
              <span className="wf-blink font-mono text-[10px] tracking-[0.14em] text-[#FFB020]" style={{ fontFamily: MONO }}>
                CONNECTING…
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span
                className={cn('h-2 w-2 rounded-full', isLive ? 'wf-blink bg-[#3DF58A]' : 'bg-[#3A4B59]')}
                style={isLive ? { boxShadow: '0 0 8px #3DF58A' } : undefined}
              />
              <span
                className="font-mono text-[10px] tracking-[0.14em]"
                style={{ fontFamily: MONO, color: isLive ? '#3DF58A' : '#3A4B59' }}
              >
                LIVE
              </span>
            </span>
          )}
        </div>

        {/* facility + frequency */}
        <div className="mt-2 text-[12px] leading-4 text-[#5F7484]" style={{ fontFamily: "'Inter', sans-serif" }}>
          {feed.facility}
        </div>
        <div className="mt-1 font-mono text-[11px] leading-4 text-[#3A4B59]" style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
          {feed.freqs} MHz
        </div>

        {/* controls */}
        <div className="mt-4 flex items-center gap-3">
          <motion.button
            type="button"
            onClick={onToggle}
            whileTap={{ scale: 0.88 }}
            transition={{ duration: 0.12 }}
            aria-label={isActive && (isLive || isConnecting) ? `Stop ${feed.label}` : `Play ${feed.label}`}
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full border transition-colors duration-150',
              isLive || isConnecting
                ? 'border-[#2EE6C8] bg-[#2EE6C8] text-[#03060A]'
                : 'border-[#2EE6C866] text-[#2EE6C8] hover:bg-[#2EE6C81A]',
            )}
          >
            {isLive || isConnecting ? (
              <Square size={13} strokeWidth={2.5} fill="currentColor" />
            ) : (
              <Play size={14} strokeWidth={2.5} fill="currentColor" className="ml-0.5" />
            )}
          </motion.button>

          <EqBars count={3} active={isLive} color={isError ? '#FF3B47' : '#2EE6C8'} />

          {isError && (
            <button
              type="button"
              onClick={retry}
              className="flex items-center gap-1.5 rounded-[2px] border border-[#FF3B4755] px-2 py-1 font-mono text-[10px] tracking-[0.14em] text-[#FF3B47] transition-colors duration-150 hover:bg-[#FF3B4714]"
              style={{ fontFamily: MONO }}
            >
              <RotateCcw size={10} strokeWidth={2.5} />
              RETRY
            </button>
          )}

          <a
            href={liveatcPageUrl(feed.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.14em] text-[#5F7484] transition-colors duration-150 hover:text-[#2EE6C8]"
            style={{ fontFamily: MONO }}
          >
            OPEN FEED
            <ExternalLink size={10} strokeWidth={2} />
          </a>
        </div>
      </HudFrame>
    </motion.div>
  );
}

const AudioCard = memo(AudioCardInner);
export default AudioCard;
