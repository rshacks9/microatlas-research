import { memo, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { motion } from 'framer-motion';
import { Square } from 'lucide-react';
import { useRadio } from './RadioContext';

const BANDS = 5;
const BAR_COLOR = '#2EE6C8';

/**
 * 5-band EQ driven by the Web Audio AnalyserNode on the live stream at ~30Hz.
 * If CORS blocks the analyser (analyser === null), a gentle synthetic 500ms
 * cycle runs instead — playback itself is unaffected.
 */
function useEqLoop(
  barsRef: RefObject<(HTMLSpanElement | null)[]>,
  analyser: AnalyserNode | null,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      barsRef.current?.forEach((b) => {
        if (b) b.style.transform = 'scaleY(0.5)';
      });
      return;
    }
    let raf = 0;
    let last = 0;
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 33) return; // ~30Hz
      last = t;
      const bars = barsRef.current;
      if (!bars) return;
      for (let i = 0; i < BANDS; i++) {
        const el = bars[i];
        if (!el) continue;
        let level: number;
        if (analyser && data) {
          analyser.getByteFrequencyData(data);
          const idx = Math.min(data.length - 1, 2 + i * 3);
          level = data[idx] / 255;
          if (level < 0.06) level = 0.06;
        } else {
          // fallback: calm 500ms-period cycle with per-band phase
          level = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(t / 500 + i * 1.4));
        }
        el.style.transform = `scaleY(${Math.min(1, level)})`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analyser, active, barsRef]);
}

function NowPlayingBarInner() {
  const { active, status, volume, analyser, stop, setVolume } = useRadio();
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);
  useEqLoop(barsRef, analyser, status === 'live' || status === 'connecting');

  if (!active) return null;

  return (
    <motion.div
      initial={{ y: '-100%', opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: '-100%', opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="sticky top-14 z-40 mx-auto w-full max-w-[1440px] px-6"
    >
      <div className="relative flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[2px] border border-[#2EE6C833] bg-[#070C12F2] px-4 py-2.5 shadow-[0_0_24px_rgba(46,230,200,0.08)] backdrop-blur-sm">
        <span aria-hidden className="inline-flex items-end gap-[3px]" style={{ height: 18 }}>
          {Array.from({ length: BANDS }).map((_, i) => (
            <span
              key={i}
              ref={(el) => {
                barsRef.current[i] = el;
              }}
              style={{
                width: 3,
                height: '100%',
                backgroundColor: BAR_COLOR,
                transformOrigin: 'bottom',
                transform: 'scaleY(0.2)',
                boxShadow: `0 0 6px ${BAR_COLOR}`,
              }}
            />
          ))}
        </span>

        <span className="font-mono text-[10px] tracking-[0.14em] text-[#3DF58A]" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
          NOW PLAYING
        </span>
        <span
          className="text-[12px] font-semibold tracking-[0.08em] text-[#D7E6EF]"
          style={{ fontFamily: "'Chakra Petch', sans-serif" }}
        >
          {active.label}
        </span>
        <span className="font-mono text-[11px] text-[#5F7484]" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
          {active.facility}
        </span>
        {status === 'connecting' && (
          <span className="wf-blink font-mono text-[10px] tracking-[0.14em] text-[#FFB020]" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
            CONNECTING…
          </span>
        )}
        {status === 'error' && (
          <span className="font-mono text-[10px] tracking-[0.14em] text-[#FF3B47]" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
            STREAM ERROR
          </span>
        )}

        <span className="ml-auto flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => setVolume(Number(e.target.value) / 100)}
            aria-label="Volume"
            className="h-1 w-24 cursor-pointer accent-[#2EE6C8]"
          />
          <button
            type="button"
            onClick={stop}
            className="flex items-center gap-1.5 rounded-[2px] border border-[#FF3B4755] px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-[#FF3B47] transition-colors duration-150 hover:bg-[#FF3B4714]"
            style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
          >
            <Square size={9} strokeWidth={2.5} fill="currentColor" />
            STOP
          </button>
        </span>
      </div>
    </motion.div>
  );
}

const NowPlayingBar = memo(NowPlayingBarInner);
export default NowPlayingBar;
