import { useEffect } from 'react';
import Lenis from 'lenis';
import { AnimatePresence, motion } from 'framer-motion';
import { RadioProvider, useRadio } from '@/components/signals/RadioContext';
import NowPlayingBar from '@/components/signals/NowPlayingBar';
import AudioCard from '@/components/signals/AudioCard';
import SectionHeader from '@/components/signals/SectionHeader';
import ScannerRow from '@/components/signals/ScannerRow';
import { FeaturedUvbCard, HfCard } from '@/components/signals/HfCards';
import { ATC_FEEDS, ATC_REGIONS, HF_STATIONS, SCANNER_LINKS, TOTAL_FEEDS } from '@/components/signals/signalsData';

const CHAKRA = "'Chakra Petch', sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";
const INTER = "'Inter', sans-serif";
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap';

const KEYFRAMES = `
@keyframes wf-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
.wf-blink { animation: wf-blink 1.2s steps(2, end) infinite; }
@keyframes wf-eq { 0%, 100% { transform: scaleY(0.25); } 50% { transform: scaleY(1); } }
.wf-eq { animation: wf-eq 0.5s ease-in-out infinite; }
@keyframes wf-buzzer { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
.wf-buzzer { animation: wf-buzzer 4.625s ease-in-out infinite; }
@keyframes wf-errflash { 0%, 100% { border-color: rgba(255,59,71,0.25); } 50% { border-color: rgba(255,59,71,0.85); } }
.wf-errflash { animation: wf-errflash 0.9s ease-in-out 2; }
@media (prefers-reduced-motion: reduce) {
  .wf-blink, .wf-buzzer, .wf-errflash { animation: none !important; }
  .wf-eq { animation: none !important; transform: scaleY(0.5) !important; }
}
`;

function usePageSetup() {
  // Fonts (idempotent — shared design system may also load them)
  useEffect(() => {
    if (!document.querySelector(`link[href="${FONTS_HREF}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = FONTS_HREF;
      document.head.appendChild(link);
    }
    if (!document.getElementById('wf-signals-style')) {
      const style = document.createElement('style');
      style.id = 'wf-signals-style';
      style.textContent = KEYFRAMES;
      document.head.appendChild(style);
    }
    return () => {
      document.getElementById('wf-signals-style')?.remove();
    };
  }, []);

  // Lenis smooth scroll — only if no other owner already installed it
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const w = window as unknown as { __wfLenis?: Lenis };
    if (w.__wfLenis) return;
    const lenis = new Lenis({ duration: 1.1 });
    w.__wfLenis = lenis;
    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      if (w.__wfLenis === lenis) delete w.__wfLenis;
      lenis.destroy();
    };
  }, []);
}

function PageHeader() {
  const { active, status } = useRadio();
  const title = 'THE AIRWAVES, UNFILTERED';
  return (
    <header className="pt-16">
      <motion.div
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="flex items-center gap-2"
      >
        <span className="wf-blink h-2 w-2 rounded-full bg-[#3DF58A]" style={{ boxShadow: '0 0 8px #3DF58A' }} />
        <span className="text-[11px] font-medium uppercase leading-[14px] tracking-[0.14em] text-[#5F7484]" style={{ fontFamily: CHAKRA }}>
          SIGNALS // RADIO
        </span>
      </motion.div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-[720px]">
          <h1
            className="text-[40px] font-bold leading-[44px] tracking-[0.08em] text-[#D7E6EF]"
            style={{ fontFamily: CHAKRA, textShadow: '0 0 18px rgba(46,230,200,0.18)' }}
            aria-label={title}
          >
            {title.split('').map((ch, i) => (
              <motion.span
                key={i}
                aria-hidden
                className="inline-block"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 + Math.min(i, 20) * 0.015, ease: EASE }}
              >
                {ch === ' ' ? ' ' : ch}
              </motion.span>
            ))}
          </h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.3, ease: EASE }}
            className="mt-4 max-w-[640px] text-[14px] leading-5 text-[#5F7484]"
            style={{ fontFamily: INTER }}
          >
            Live air traffic control towers, HF numbers stations, and regional scanners. LiveATC feeds play inline; HF
            frequencies open on public WebSDR receivers pre-tuned to the dial.
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.25, ease: EASE }}
          className="flex items-center gap-4"
        >
          <div className="text-right">
            <div className="font-mono text-[24px] font-bold leading-7 text-[#2EE6C8]" style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
              {TOTAL_FEEDS}
            </div>
            <div className="font-mono text-[10px] tracking-[0.14em] text-[#3A4B59]" style={{ fontFamily: MONO }}>
              FEEDS INDEXED
            </div>
          </div>
          <div className="h-8 w-px bg-[#182635]" />
          <div className="text-right">
            <div className="font-mono text-[13px] leading-5 text-[#D7E6EF]" style={{ fontFamily: MONO }}>
              {active ? active.label : 'STANDBY'}
            </div>
            <div className="font-mono text-[10px] tracking-[0.14em]" style={{ fontFamily: MONO, color: status === 'live' ? '#3DF58A' : '#3A4B59' }}>
              NOW PLAYING
            </div>
          </div>
        </motion.div>
      </div>
    </header>
  );
}

function NowPlayingMount() {
  const { active } = useRadio();
  return <AnimatePresence>{active ? <NowPlayingBar key="npb" /> : null}</AnimatePresence>;
}

function AtcBand() {
  let cardIndex = 0;
  return (
    <section>
      <SectionHeader
        title="BAND 01 // AIR TRAFFIC CONTROL"
        chipLabel="LIVE VIA LIVEATC"
        chipTone="live"
        count={ATC_FEEDS.length}
        note="Volunteer-hosted tower and approach receivers. Feeds play inline — one stream at a time; starting a feed stops the previous."
      />
      <div className="space-y-8">
        {ATC_REGIONS.map((region) => {
          const feeds = ATC_FEEDS.filter((f) => f.region === region);
          if (feeds.length === 0) return null;
          return (
            <div key={region}>
              <motion.div
                initial={{ opacity: 0, x: -12 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.4, ease: EASE }}
                className="mb-3 flex items-center gap-3"
              >
                <span className="font-mono text-[11px] tracking-[0.14em] text-[#3A4B59]" style={{ fontFamily: MONO }}>
                  {region}
                </span>
                <span className="h-px flex-1 bg-[#182635]" />
                <span className="font-mono text-[10px] text-[#3A4B59]" style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
                  {feeds.length}
                </span>
              </motion.div>
              <div className="grid grid-cols-1 gap-4 min-[720px]:grid-cols-2 min-[1100px]:grid-cols-3">
                {feeds.map((feed) => (
                  <AudioCard key={feed.id} feed={feed} index={cardIndex++} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HfBand() {
  return (
    <section>
      <SectionHeader
        title="BAND 02 // HF · NUMBERS · UTILITIES"
        chipLabel="VIA PUBLIC WEBSDR / KIWISDR NETWORKS"
        chipTone="info"
        count={HF_STATIONS.length + 1}
        note="These frequencies are received live by public SDR receivers. Links open the receiver pre-tuned. External links open in a new tab."
      />
      <div className="grid grid-cols-1 gap-4 min-[720px]:grid-cols-2">
        <FeaturedUvbCard />
        {HF_STATIONS.map((s, i) => (
          <HfCard key={s.name} station={s} index={i} />
        ))}
      </div>
    </section>
  );
}

function ScannerBand() {
  return (
    <section>
      <SectionHeader
        title="BAND 03 // REGIONAL SCANNERS"
        chipLabel="EXTERNAL · BROADCASTIFY"
        chipTone="dim"
        count={SCANNER_LINKS.length}
        note="Licensed scanner rebroadcasts hosted on Broadcastify. External links open in a new tab."
      />
      <div className="grid grid-cols-1 gap-2 min-[720px]:grid-cols-2">
        {SCANNER_LINKS.map((link, i) => (
          <ScannerRow key={link.url} link={link} index={i} />
        ))}
      </div>
    </section>
  );
}

function EthicsBand() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, ease: EASE }}
      className="grid grid-cols-1 gap-8 border-t border-[#182635] pt-8 min-[720px]:grid-cols-2"
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <h3 className="text-[11px] font-medium uppercase leading-[14px] tracking-[0.14em] text-[#5F7484]" style={{ fontFamily: CHAKRA }}>
          RECEPTION NOTES
        </h3>
        <p className="mt-3 max-w-[520px] text-[12px] leading-5 text-[#5F7484]" style={{ fontFamily: INTER }}>
          HF propagation varies with solar conditions and time of day — a dead frequency at noon may be wide open at
          night. WebSDR receivers are shared public resources: tune respectfully and let others listen. LiveATC streams
          are volunteer-hosted and may go offline; error states here are shown honestly, with a retry that re-attempts
          the real feed URL.
        </p>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.5, delay: 0.1, ease: EASE }}
      >
        <h3 className="text-[11px] font-medium uppercase leading-[14px] tracking-[0.14em] text-[#5F7484]" style={{ fontFamily: CHAKRA }}>
          LEGAL / ETHICS
        </h3>
        <p className="mt-3 max-w-[520px] text-[12px] leading-5 text-[#5F7484]" style={{ fontFamily: INTER }}>
          Every feed on this page is a public broadcast intended for public listening — no interception, no decryption,
          no restricted traffic. Links point to licensed rebroadcasters (LiveATC, Broadcastify) and public
          university/amateur SDR receivers (WebSDR, KiwiSDR). If a feed owner goes offline, its card says so.
        </p>
      </motion.div>
    </motion.section>
  );
}

function SignalsInner() {
  usePageSetup();
  return (
    <div className="relative min-h-[100dvh] bg-[#03060A] pb-24 text-[#D7E6EF]" style={{ fontFamily: INTER }}>
      {/* scanline overlay (page-scoped, non-interactive) */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-30"
        style={{
          background: 'repeating-linear-gradient(0deg, rgba(215,230,239,0.03) 0px, rgba(215,230,239,0.03) 1px, transparent 1px, transparent 3px)',
        }}
      />
      <div className="mx-auto w-full max-w-[1440px] px-6">
        <PageHeader />
      </div>
      <div className="mt-6">
        <NowPlayingMount />
      </div>
      <main className="mx-auto mt-14 flex w-full max-w-[1440px] flex-col gap-16 px-6">
        <AtcBand />
        <HfBand />
        <ScannerBand />
        <EthicsBand />
      </main>
    </div>
  );
}

export default function Signals() {
  return (
    <RadioProvider>
      <SignalsInner />
    </RadioProvider>
  );
}
