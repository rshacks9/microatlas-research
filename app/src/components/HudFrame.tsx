/**
 * HudFrame — hairline HUD panel with corner brackets (▛ ▟ style,
 * 1px arms, 12px long). Wraps every console panel.
 */

import type { CSSProperties, ReactNode } from 'react';

const ARM = 12;
const COLOR = 'var(--line)';
const HI = 'var(--line-hi)';

function Corner({ pos, active }: { pos: 'tl' | 'tr' | 'bl' | 'br'; active: boolean }) {
  const base: CSSProperties = {
    position: 'absolute',
    width: ARM,
    height: ARM,
    pointerEvents: 'none',
    borderColor: active ? HI : COLOR,
    borderStyle: 'solid',
    borderWidth: 0,
  };
  const borders: Record<typeof pos, CSSProperties> = {
    tl: { top: -1, left: -1, borderTopWidth: 1, borderLeftWidth: 1 },
    tr: { top: -1, right: -1, borderTopWidth: 1, borderRightWidth: 1 },
    bl: { bottom: -1, left: -1, borderBottomWidth: 1, borderLeftWidth: 1 },
    br: { bottom: -1, right: -1, borderBottomWidth: 1, borderRightWidth: 1 },
  };
  return <span style={{ ...base, ...borders[pos] }} aria-hidden />;
}

export default function HudFrame({
  children,
  className = '',
  active = false,
  style,
}: {
  children: ReactNode;
  className?: string;
  active?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div className={`wf-panel relative ${active ? 'wf-glow' : ''} ${className}`} style={style}>
      <Corner pos="tl" active={active} />
      <Corner pos="tr" active={active} />
      <Corner pos="bl" active={active} />
      <Corner pos="br" active={active} />
      {children}
    </div>
  );
}
