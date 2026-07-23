/**
 * CountUp — tabular number that tweens from 0 (or its previous value)
 * to the target over `duration`. Disabled under prefers-reduced-motion.
 */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { animate, useReducedMotion } from 'framer-motion';

export default function CountUp({
  value,
  duration = 0.8,
  decimals = 0,
  className = '',
  style,
}: {
  value: number;
  duration?: number;
  decimals?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      prevRef.current = value;
      return;
    }
    const from = prevRef.current;
    const controls = animate(from, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(v),
    });
    prevRef.current = value;
    return () => controls.stop();
  }, [value, duration, reduce]);

  return (
    <span className={`tabular-nums ${className}`} style={style}>
      {display.toFixed(decimals)}
    </span>
  );
}
