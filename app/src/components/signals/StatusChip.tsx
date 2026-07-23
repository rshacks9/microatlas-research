import { memo } from 'react';
import { cn } from '@/lib/utils';

export type ChipTone = 'live' | 'stale' | 'error' | 'info' | 'dim';

const TONES: Record<ChipTone, { dot: string; text: string; border: string; blink: boolean }> = {
  live: { dot: '#3DF58A', text: '#3DF58A', border: '#3DF58A33', blink: true },
  stale: { dot: '#FFB020', text: '#FFB020', border: '#FFB02033', blink: true },
  error: { dot: '#FF3B47', text: '#FF3B47', border: '#FF3B4733', blink: false },
  info: { dot: '#4EA8FF', text: '#4EA8FF', border: '#4EA8FF33', blink: false },
  dim: { dot: '#5F7484', text: '#5F7484', border: '#182635', blink: false },
};

/** 8px status dot + uppercase mono label. Green/amber tones blink (1.2s steps). */
function StatusChipInner({ tone, label, className }: { tone: ChipTone; label: string; className?: string }) {
  const t = TONES[tone];
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-[2px] border px-2 py-1', className)}
      style={{ borderColor: t.border }}
    >
      <span
        aria-hidden
        className={t.blink ? 'wf-blink' : undefined}
        style={{ width: 8, height: 8, borderRadius: 9999, backgroundColor: t.dot, boxShadow: `0 0 8px ${t.dot}` }}
      />
      <span
        className="font-mono text-[10px] leading-none tracking-[0.14em]"
        style={{ color: t.text, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
      >
        {label}
      </span>
    </span>
  );
}

const StatusChip = memo(StatusChipInner);
export default StatusChip;
