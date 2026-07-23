import { memo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

const ARM = 12;

function Corner({ pos, color }: { pos: 'tl' | 'tr' | 'bl' | 'br'; color: string }) {
  const base: CSSProperties = { position: 'absolute', width: ARM, height: ARM, pointerEvents: 'none' };
  const styles: Record<string, CSSProperties> = {
    tl: { top: -1, left: -1, borderTop: `1px solid ${color}`, borderLeft: `1px solid ${color}` },
    tr: { top: -1, right: -1, borderTop: `1px solid ${color}`, borderRight: `1px solid ${color}` },
    bl: { bottom: -1, left: -1, borderBottom: `1px solid ${color}`, borderLeft: `1px solid ${color}` },
    br: { bottom: -1, right: -1, borderBottom: `1px solid ${color}`, borderRight: `1px solid ${color}` },
  };
  return <span aria-hidden style={{ ...base, ...styles[pos] }} />;
}

/** Hairline HUD panel with 1px corner brackets (12px arms). */
function HudFrameInner({
  children,
  className,
  bracketColor = '#2EE6C855',
  glow = false,
}: {
  children: ReactNode;
  className?: string;
  bracketColor?: string;
  glow?: boolean;
}) {
  return (
    <div
      className={cn('relative rounded-[2px] border border-[#182635] bg-[#0B121BD1]', className)}
      style={glow ? { boxShadow: '0 0 24px rgba(46,230,200,0.08)' } : undefined}
    >
      <Corner pos="tl" color={bracketColor} />
      <Corner pos="tr" color={bracketColor} />
      <Corner pos="bl" color={bracketColor} />
      <Corner pos="br" color={bracketColor} />
      {children}
    </div>
  );
}

const HudFrame = memo(HudFrameInner);
export default HudFrame;
