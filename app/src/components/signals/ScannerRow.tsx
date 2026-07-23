import { memo } from 'react';
import { motion } from 'framer-motion';
import { ExternalLink } from 'lucide-react';
import type { ScannerLink } from './signalsData';

const CHAKRA = "'Chakra Petch', sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";

function ScannerRowInner({ link, index }: { link: ScannerLink; index: number }) {
  return (
    <motion.a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.4, delay: (index % 5) * 0.04, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ x: 4 }}
      className="group flex items-center gap-3 rounded-[2px] border border-[#182635] bg-[#0B121BD1] px-4 py-3 transition-colors duration-150 hover:border-[#2EE6C833]"
    >
      <span className="w-28 shrink-0 font-mono text-[10px] tracking-[0.08em] text-[#3A4B59]" style={{ fontFamily: MONO }}>
        {link.tag}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium tracking-[0.06em] text-[#D7E6EF]" style={{ fontFamily: CHAKRA }}>
          {link.name}
        </span>
        <span className="block truncate text-[12px] leading-4 text-[#5F7484]" style={{ fontFamily: "'Inter', sans-serif" }}>
          {link.note}
        </span>
      </span>
      <span className="ml-auto inline-flex shrink-0 items-center gap-1 font-mono text-[10px] tracking-[0.14em] text-[#5F7484] transition-colors duration-150 group-hover:text-[#2EE6C8]" style={{ fontFamily: MONO }}>
        LISTEN
        <ExternalLink size={10} strokeWidth={2} />
      </span>
    </motion.a>
  );
}

const ScannerRow = memo(ScannerRowInner);
export default ScannerRow;
