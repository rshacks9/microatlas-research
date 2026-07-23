import { useEffect, useRef, useState } from 'react'
import type { ReactNode, CSSProperties } from 'react'

/** WATCHFLOOR design tokens (mirrors design.md palette — page-local, no global CSS edits) */
export const C = {
  bg0: '#03060A',
  bg1: '#070C12',
  bg2: '#0B121B',
  bg3: '#101A25',
  line: '#182635',
  lineHi: 'rgba(46,230,200,0.22)',
  ink: '#D7E6EF',
  inkDim: '#5F7484',
  inkFaint: '#3A4B59',
  cyan: '#2EE6C8',
  amber: '#FFB020',
  blue: '#4EA8FF',
  red: '#FF3B47',
  violet: '#9B8CFF',
  green: '#3DF58A',
  orange: '#FF7A45',
} as const

export const F = {
  display: "'Chakra Petch', 'Segoe UI', sans-serif",
  body: "'Inter', 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
} as const

export type FeedStatus = 'idle' | 'connecting' | 'live' | 'stale' | 'error'

export function statusColor(s: FeedStatus): string {
  switch (s) {
    case 'live':
      return C.green
    case 'connecting':
      return C.amber
    case 'stale':
      return C.amber
    case 'error':
      return C.red
    default:
      return C.inkFaint
  }
}

/** Ticking clock hook */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const fn = () => setReduced(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return reduced
}

/** Compact age formatter: 12s / 4m / 2h / 3d */
export function ageText(fromMs: number | null, nowMs: number): string {
  if (fromMs == null) return '—'
  const s = Math.max(0, Math.round((nowMs - fromMs) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/** Epoch-age with days+hours for TLE epochs: 2.3d */
export function epochAgeText(fromMs: number | null, nowMs: number): string {
  if (fromMs == null) return '—'
  const hrs = Math.max(0, (nowMs - fromMs) / 3600000)
  if (hrs < 1) return `${Math.round(hrs * 60)}m`
  if (hrs < 48) return `${hrs.toFixed(1)}h`
  return `${(hrs / 24).toFixed(1)}d`
}

/** Count-up animation for big readouts */
export function useCountUp(target: number, durationMs = 800): number {
  const [display, setDisplay] = useState(target)
  const fromRef = useRef(target)
  const rafRef = useRef(0)
  useEffect(() => {
    const from = fromRef.current
    if (from === target) return
    const start = performance.now()
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs)
      const eased = 1 - Math.pow(1 - p, 3)
      const v = Math.round(from + (target - from) * eased)
      setDisplay(v)
      if (p < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        fromRef.current = target
      }
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, durationMs])
  return display
}

/** Hairline HUD panel with 12px corner brackets */
export function HudPanel({
  children,
  accent,
  glow,
  className,
  style,
}: {
  children: ReactNode
  accent?: string
  glow?: boolean
  className?: string
  style?: CSSProperties
}) {
  const bracketColor = accent ?? C.line
  const bracket = (pos: CSSProperties) => (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        width: 12,
        height: 12,
        borderColor: bracketColor,
        borderStyle: 'solid',
        borderWidth: 0,
        pointerEvents: 'none',
        ...pos,
      }}
    />
  )
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        background: `${C.bg2}D1`,
        border: `1px solid ${C.line}`,
        borderRadius: 2,
        boxShadow: glow ? '0 0 24px rgba(46,230,200,0.08)' : undefined,
        ...style,
      }}
    >
      {bracket({ top: -1, left: -1, borderTopWidth: 1, borderLeftWidth: 1 })}
      {bracket({ top: -1, right: -1, borderTopWidth: 1, borderRightWidth: 1 })}
      {bracket({ bottom: -1, left: -1, borderBottomWidth: 1, borderLeftWidth: 1 })}
      {bracket({ bottom: -1, right: -1, borderBottomWidth: 1, borderRightWidth: 1 })}
      {children}
    </div>
  )
}

export function LiveDot({ color, blink, size = 8 }: { color: string; blink?: boolean; size?: number }) {
  return (
    <span
      className={blink ? 'wf-blink' : undefined}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 8px ${color}66`,
        flexShrink: 0,
      }}
    />
  )
}

export function StatusChip({
  status,
  label,
  age,
}: {
  status: FeedStatus
  label: string
  age?: string
}) {
  const color = statusColor(status)
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: F.mono,
        fontSize: 11,
        lineHeight: '14px',
        color: C.inkDim,
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
      }}
    >
      <LiveDot color={color} blink={status === 'live' || status === 'connecting'} size={8} />
      <span style={{ color }}>{status.toUpperCase()}</span>
      <span>·</span>
      <span>{label}</span>
      {age != null && (
        <>
          <span>·</span>
          <span style={{ color: C.inkFaint }}>{age}</span>
        </>
      )}
    </span>
  )
}

export function Eyebrow({ text, color = C.cyan }: { text: string; color?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: F.display,
        fontWeight: 500,
        fontSize: 11,
        lineHeight: '14px',
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: C.inkDim,
      }}
    >
      <LiveDot color={color} blink size={6} />
      {text}
    </div>
  )
}

/** Page-local keyframes + utility classes (wf- prefixed; ships only with this page) */
export function TrackingKeyframes() {
  return (
    <style>{`
      @keyframes wf-blink-kf { 0%,100% { opacity: 1 } 50% { opacity: .25 } }
      .wf-blink { animation: wf-blink-kf 1.2s steps(2, jump-none) infinite; }
      @keyframes wf-sweep-kf { 0% { transform: translateY(-8px); opacity: 0 } 12% { opacity: 1 } 100% { transform: translateY(560px); opacity: 0 } }
      .wf-sweep { animation: wf-sweep-kf .6s linear 1; }
      @keyframes wf-pulse-red-kf { 0%,100% { box-shadow: inset 2px 0 0 #FF3B47 } 50% { box-shadow: inset 2px 0 0 #FF3B47, 0 0 14px rgba(255,59,71,.35) } }
      .wf-pulse-red { animation: wf-pulse-red-kf 2s ease-in-out infinite; }
      @keyframes wf-cellflash-kf { 0% { color: #2EE6C8; text-shadow: 0 0 8px rgba(46,230,200,.8) } 100% { color: inherit; text-shadow: none } }
      .wf-cellflash { animation: wf-cellflash-kf .6s ease-out 1; }
      .wf-tabular { font-variant-numeric: tabular-nums; }
      /* neutralize template App.css #root constraint while this page is mounted */
      #root { max-width: none !important; padding: 0 !important; text-align: left !important; }
      .wf-rowhover:hover { background: #101A25; box-shadow: inset 2px 0 0 #2EE6C8; }
      .wf-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
      .wf-scroll::-webkit-scrollbar-track { background: #070C12; }
      .wf-scroll::-webkit-scrollbar-thumb { background: #182635; border-radius: 2px; }
      .wf-scroll::-webkit-scrollbar-thumb:hover { background: #2EE6C855; }
      .wf-scroll { scrollbar-width: thin; scrollbar-color: #182635 #070C12; }
      @media (prefers-reduced-motion: reduce) {
        .wf-blink, .wf-sweep, .wf-pulse-red, .wf-cellflash { animation: none !important; }
      }
    `}</style>
  )
}

/** Generic virtual-window hook for fixed-row-height tables with one expandable row */
export function useVirtualWindow(
  rowCount: number,
  rowHeight: number,
  expandedIndex: number,
  expandedHeight: number,
  overscan = 8,
) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(560)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight))
    ro.observe(el)
    setViewportH(el.clientHeight)
    return () => ro.disconnect()
  }, [])
  const expH = expandedIndex >= 0 ? expandedHeight : 0
  const totalHeight = rowCount * rowHeight + expH
  const rowOffset = (i: number) => i * rowHeight + (expandedIndex >= 0 && i > expandedIndex ? expH : 0)
  const estimate = Math.floor(scrollTop / rowHeight) - overscan
  const start = Math.max(0, Math.min(Math.max(0, rowCount - 1), estimate - (expandedIndex >= 0 ? 1 : 0)))
  const end = Math.min(rowCount - 1, Math.ceil((scrollTop + viewportH) / rowHeight) + overscan + (expandedIndex >= 0 ? 1 : 0))
  return { ref, setScrollTop, start, end, totalHeight, rowOffset, viewportH }
}
