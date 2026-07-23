import { memo } from 'react';
import { motion } from 'framer-motion';
import StatusChip from './StatusChip';
import type { ChipTone } from './StatusChip';

const CHAKRA = "'Chakra Petch', sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";

function SectionHeaderInner({
  title,
  chipLabel,
  chipTone,
  note,
  count,
}: {
  title: string;
  chipLabel: string;
  chipTone: ChipTone;
  note?: string;
  count?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="mb-6 border-b border-[#182635] pb-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[20px] font-semibold leading-[26px] tracking-[0.08em] text-[#D7E6EF]" style={{ fontFamily: CHAKRA }}>
          {title}
        </h2>
        <StatusChip tone={chipTone} label={chipLabel} />
        {typeof count === 'number' && (
          <span className="ml-auto font-mono text-[11px] tracking-[0.1em] text-[#3A4B59]" style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
            {count} FEEDS
          </span>
        )}
      </div>
      {note && (
        <p className="mt-2 max-w-[640px] text-[12px] leading-4 text-[#5F7484]" style={{ fontFamily: "'Inter', sans-serif" }}>
          {note}
        </p>
      )}
    </motion.div>
  );
}

const SectionHeader = memo(SectionHeaderInner);
export default SectionHeader;
