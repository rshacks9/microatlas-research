/**
 * CORS proxy-chain fetcher, per design.md data architecture:
 * direct → corsproxy.io → allorigins → isomorphic-git.
 * Tracks per-route outcomes so the UI can show the chain honestly.
 */

export interface ProxyRoute {
  id: string
  label: string
  build: (url: string) => string
}

export const PROXY_ROUTES: ProxyRoute[] = [
  { id: 'direct', label: 'DIRECT', build: (u) => u },
  { id: 'corsproxy', label: 'CORSPROXY.IO', build: (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}` },
  { id: 'allorigins', label: 'ALLORIGINS', build: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
  { id: 'isogit', label: 'ISOMORPHIC-GIT', build: (u) => `https://cors.isomorphic-git.org/${u}` },
  { id: 'corslol', label: 'CORS.LOL', build: (u) => `https://api.cors.lol/url?url=${encodeURIComponent(u)}` },
  { id: 'corseu', label: 'CORS.EU.ORG', build: (u) => `https://cors.eu.org/${u}` },
]

export type RouteStatus = 'untested' | 'ok' | 'fail' | 'ratelimited'

export interface ChainResult {
  res: Response
  routeIndex: number
  routeStatuses: RouteStatus[]
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { accept: '*/*' } })
  } finally {
    clearTimeout(id)
  }
}

/**
 * Try each route in order (starting from a previously-working route) until one
 * returns an OK response. Throws with per-route statuses if all fail.
 */
export async function fetchViaChain(
  url: string,
  opts: { timeoutMs?: number; preferredRoute?: number } = {},
): Promise<ChainResult> {
  const timeoutMs = opts.timeoutMs ?? 15000
  const order: number[] = []
  const pref = opts.preferredRoute ?? 0
  for (let i = 0; i < PROXY_ROUTES.length; i++) order.push((pref + i) % PROXY_ROUTES.length)

  const routeStatuses: RouteStatus[] = PROXY_ROUTES.map(() => 'untested')
  let lastError: unknown = null
  for (const idx of order) {
    const route = PROXY_ROUTES[idx]
    try {
      const res = await fetchWithTimeout(route.build(url), timeoutMs)
      if (res.ok) {
        routeStatuses[idx] = 'ok'
        return { res, routeIndex: idx, routeStatuses }
      }
      routeStatuses[idx] = res.status === 429 ? 'ratelimited' : 'fail'
      lastError = new Error(`HTTP ${res.status} via ${route.label}`)
    } catch (e) {
      routeStatuses[idx] = 'fail'
      lastError = e
    }
  }
  const err = new Error(lastError instanceof Error ? lastError.message : 'all proxy routes failed') as Error & {
    routeStatuses?: RouteStatus[]
  }
  err.routeStatuses = routeStatuses
  throw err
}
