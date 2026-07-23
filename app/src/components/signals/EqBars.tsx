import { memo } from 'react';

/**
 * Isolated perpetual-animation micro-component (memoized so parent re-renders
 * never reset it). CSS-driven bars; under prefers-reduced-motion the global
 * wf-anim reset freezes them at a static mid height.
 */
function EqBarsInner({
  count = 3,
  color = '#2EE6C8',
  height = 14,
  barWidth = 3,
  gap = 2,
  active = true,
}: {
  count?: number;
  color?: string;
  height?: number;
  barWidth?: number;
  gap?: number;
  active?: boolean;
}) {
  return (
    <span aria-hidden className="inline-flex items-end" style={{ height, gap }}>
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className="wf-eq"
          style={{
            width: barWidth,
            height: '100%',
            backgroundColor: color,
            transformOrigin: 'bottom',
            transform: active ? undefined : 'scaleY(0.35)',
            animationDelay: `${(i * 137) % 500}ms`,
            animationDuration: `${440 + ((i * 97) % 260)}ms`,
            animationPlayState: active ? 'running' : 'paused',
            boxShadow: active ? `0 0 6px ${color}` : undefined,
          }}
        />
      ))}
    </span>
  );
}

const EqBars = memo(EqBarsInner);
export default EqBars;
