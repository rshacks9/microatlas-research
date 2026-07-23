import { memo } from 'react';
import { motion } from 'framer-motion';
import { ExternalLink, Radio } from 'lucide-react';
import HudFrame from './HudFrame';
import { KIWISDR_DIRECTORY, WEBSDR_DIRECTORY, websdrTune } from './signalsData';
import type { HfStation } from './signalsData';
import { UVB76 } from './signalsData';

const CHAKRA = "'Chakra Petch', sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";
const INTER = "'Inter', sans-serif";

function TuneButton({ href, label, red = false }: { href: string; label: string; red?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-[2px] border px-3 py-1.5 font-mono text-[10px] tracking-[0.14em] transition-colors duration-150"
      style={{
        fontFamily: MONO,
        borderColor: red ? '#FF3B4755' : '#4EA8FF44',
        color: red ? '#FF3B47' : '#4EA8FF',
      }}
    >
      {label}
      <ExternalLink size={10} strokeWidth={2} />
    </a>
  );
}

/** Featured UVB-76 card — spans 2 cols, red brackets, buzzer-cadence pulse on the frequency. */
export const FeaturedUvbCard = memo(function FeaturedUvbCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -2 }}
      className="min-[720px]:col-span-2"
    >
      <HudFrame bracketColor="#FF3B47" className="h-full border-[#FF3B4740] p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Radio size={16} strokeWidth={2} className="text-[#FF3B47]" />
              <span className="text-[20px] font-semibold leading-[26px] tracking-[0.08em] text-[#D7E6EF]" style={{ fontFamily: CHAKRA }}>
                {UVB76.name}
              </span>
            </div>
            <div
              className="wf-buzzer mt-2 font-mono text-[24px] font-bold leading-7 text-[#FF3B47]"
              style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums', textShadow: '0 0 12px rgba(255,59,71,0.45)' }}
            >
              {UVB76.freqLabel}
            </div>
          </div>
          <span className="rounded-[2px] border border-[#FF3B4733] px-2 py-1 font-mono text-[10px] tracking-[0.14em] text-[#FF3B47]" style={{ fontFamily: MONO }}>
            NUMBERS STATION
          </span>
        </div>

        <p className="mt-4 max-w-[560px] text-[12px] leading-5 text-[#5F7484]" style={{ fontFamily: INTER }}>
          {UVB76.description}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <TuneButton href={UVB76.tuneUrl} label="WEBSDR TWENTE · 4625 USB" red />
          <TuneButton href={KIWISDR_DIRECTORY} label="KIWISDR DIRECTORY" red />
          <TuneButton href={WEBSDR_DIRECTORY} label="WEBSDR.ORG" red />
        </div>

        <div className="mt-4 font-mono text-[10px] tracking-[0.1em] text-[#3A4B59]" style={{ fontFamily: MONO }}>
          RECEPTION VARIES BY PROPAGATION &amp; TIME OF DAY
        </div>
      </HudFrame>
    </motion.div>
  );
});

export const HfCard = memo(function HfCard({ station, index }: { station: HfStation; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, delay: 0.08 + index * 0.07, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -2 }}
    >
      <HudFrame bracketColor="#4EA8FF55" className="h-full p-5 hover:border-[#4EA8FF33]">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[14px] font-semibold tracking-[0.08em] text-[#D7E6EF]" style={{ fontFamily: CHAKRA }}>
            {station.name}
          </span>
          <span className="rounded-[2px] border border-[#4EA8FF33] px-2 py-0.5 font-mono text-[9px] tracking-[0.14em] text-[#4EA8FF]" style={{ fontFamily: MONO }}>
            {station.tag}
          </span>
        </div>
        <div className="mt-1.5 font-mono text-[13px] leading-4 text-[#4EA8FF]" style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
          {station.freqLabel}
        </div>
        <p className="mt-3 text-[12px] leading-5 text-[#5F7484]" style={{ fontFamily: INTER }}>
          {station.description}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <TuneButton href={websdrTune(station.freqKhz, station.mode)} label={'TUNE ' + station.freqLabel} />
          <TuneButton href={WEBSDR_DIRECTORY} label="WEBSDR.ORG" />
        </div>
      </HudFrame>
    </motion.div>
  );
});
