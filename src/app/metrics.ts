// Usage metrics: "how far into the 3-minute tour do visitors actually get?"
//
// Cloudflare Web Analytics (the beacon in index.html) counts page loads; a
// page load is not a visit that threw a ball or reached the axis. This module
// turns the tour's own milestones (tourGuide.ts event ids) into a funnel and
// ships it to POST /metric (worker/index.ts → Workers Analytics Engine,
// 3-month retention, SQL-readable). Schema and the SQL cookbook: docs/metrics.md.
//
// PRIVACY: no account, no cookie, no personal data. A random id in
// localStorage separates "ten loads by one person" from "ten people" — that is
// its only job. `?metrics=off` disables shipping for good on that browser;
// `?metrics=dev` tags the maintainer's own QA loads so queries can exclude them
// (at this project's scale they would otherwise dominate); `?metrics=public`
// clears either.
//
// The module is pure apart from the injected clock/sender so metrics.test.ts
// can drive a whole visit (load → throw → axis → leave) without a browser.

import type { TourEventId } from './tourGuide'

export const METRICS_ENDPOINT = '/metric'
export const VISITOR_KEY = 'spinward-visitor'
export const AUDIENCE_KEY = 'spinward-metrics'
export const WIRE_VERSION = 1
const DAY_MS = 86_400_000

// Tour events that count as funnel milestones. 'start' is the boot card (every
// load has it) and 'enter-grounded' is landing noise; neither says anything
// about how far the visitor got.
export const MILESTONES: readonly TourEventId[] = [
  'throw',
  'jump',
  'overlook',
  'axis',
  'surface',
  'spin-change',
  'drive',
  'rain',
  'enter-freefly',
  'look-lock'
]

export type Audience = 'public' | 'dev' | 'off'
export type Device = 'desktop' | 'touch' | 'vr'

export type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type Visitor = {
  id: string
  first: string
  visits: number
  days: number
  persisted: boolean
}

export type MetricsContext = {
  preset: string
  // 'shared' when the URL carried a share pose (someone followed a link to a
  // specific view), 'landing' for the plain front door.
  entry: 'landing' | 'shared'
  device: 'desktop' | 'touch'
  lang: string
  tier: string
}

export type MetricsEvent = {
  e: 'session' | 'milestone' | 'vr-start' | 'vr-end' | 'leave' | 'boot-fail'
  m?: string
  preset: string
  entry: string
  device: Device
  lang: string
  tier: string
  ref?: string
  reason?: string
  secs?: number
  hidden?: number
  visits?: number
  days?: number
  depth?: number
  fps?: number
}

export const randomId = (): string => {
  try {
    const c = globalThis.crypto
    if (c && typeof c.getRandomValues === 'function') {
      const b = new Uint8Array(8)
      c.getRandomValues(b)
      let out = ''
      for (const v of b) out += (v + 0x100).toString(16).slice(1)
      return out
    }
  } catch {
    // fall through
  }
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
}

const dayStamp = (ms: number) => new Date(ms).toISOString().slice(0, 10)

// Read-modify-write the visitor record. `visits` is 1 on the very first load
// ever and 0 when storage is denied (private mode): a zero means "this browser
// would not let us tell", which is different from "first-timer".
export const readVisitor = (
  store: StorageLike | null,
  nowMs: number,
  mkId: () => string = randomId
): Visitor => {
  let raw: string | null = null
  try {
    raw = store ? store.getItem(VISITOR_KEY) : null
  } catch {
    raw = null
  }
  let rec: { id?: unknown; first?: unknown; visits?: unknown } | null = null
  if (raw) {
    try {
      rec = JSON.parse(raw)
    } catch {
      rec = null
    }
  }

  let id: string
  let first: string
  let visits: number
  if (rec && typeof rec.id === 'string' && rec.id) {
    id = rec.id
    first = typeof rec.first === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rec.first) ? rec.first : dayStamp(nowMs)
    visits = (typeof rec.visits === 'number' && rec.visits > 0 ? rec.visits : 0) + 1
  } else {
    id = mkId()
    first = dayStamp(nowMs)
    visits = 1
  }

  let persisted = false
  try {
    store?.setItem(VISITOR_KEY, JSON.stringify({ id, first, visits }))
    persisted = store !== null
  } catch {
    persisted = false
  }
  if (!persisted) visits = 0

  let days = Math.round((nowMs - Date.parse(first + 'T00:00:00Z')) / DAY_MS)
  if (!Number.isFinite(days) || days < 0) days = 0
  return { id, first, visits, days, persisted }
}

// 'off' | 'dev' | 'public'. The query parameter is sticky per browser.
export const readAudience = (store: StorageLike | null, search: string): Audience => {
  let wanted: Audience | null = null
  try {
    const v = (new URLSearchParams(search).get('metrics') ?? '').toLowerCase()
    if (v === 'off' || v === 'dev' || v === 'public') wanted = v
  } catch {
    wanted = null
  }
  try {
    if (store) {
      if (wanted === 'public') store.removeItem(AUDIENCE_KEY)
      else if (wanted) store.setItem(AUDIENCE_KEY, wanted)
      const held = store.getItem(AUDIENCE_KEY)
      if (held === 'off' || held === 'dev') return held
    }
  } catch {
    if (wanted && wanted !== 'public') return wanted
  }
  return wanted === 'off' || wanted === 'dev' ? wanted : 'public'
}

// The referrer's host only (never the path), and never our own host.
export const referrerHost = (referrer: string, ownHost: string): string => {
  if (!referrer) return ''
  try {
    const host = new URL(referrer).hostname
    return host && host !== ownHost ? host.slice(0, 64) : ''
  } catch {
    return ''
  }
}

export type RecorderConfig = {
  now: () => number
  emit: (event: MetricsEvent) => void
  context: MetricsContext
}

// Turns the visit's transitions into data points. Seconds are VISIBLE seconds:
// a background tab's requestAnimationFrame loop is stopped, so wall clock
// would count parked time as touring (ysflight-web learned this the hard way:
// one parked phone once was a whole day's minutes). `hidden` ships alongside
// so the subtraction is auditable.
export const createRecorder = ({ now, emit, context }: RecorderConfig) => {
  const loadMs = now()
  const reached = new Set<string>()
  let sawVr = false
  let vrStartMs: number | null = null
  let hiddenSince: number | null = null
  let hiddenTotalMs = 0
  let closed = false

  const hiddenSoFar = () => (hiddenSince === null ? 0 : Math.max(0, now() - hiddenSince))
  const visibleSecs = () =>
    Math.max(0, Math.round((now() - loadMs - hiddenTotalMs - hiddenSoFar()) / 1000))
  const hiddenSecs = () => Math.max(0, Math.round((hiddenTotalMs + hiddenSoFar()) / 1000))

  const base = (): Omit<MetricsEvent, 'e'> => ({
    preset: context.preset,
    entry: context.entry,
    device: sawVr ? 'vr' : context.device,
    lang: context.lang,
    tier: context.tier
  })

  return {
    session(visitor: Visitor, ref: string) {
      if (closed) return
      emit({ e: 'session', ...base(), visits: visitor.visits, days: visitor.days, ref })
    },
    // First occurrence per page load only: the funnel asks "did they ever",
    // and `secs` answers "how long did it take".
    milestone(id: TourEventId) {
      if (closed || !MILESTONES.includes(id) || reached.has(id)) return false
      reached.add(id)
      emit({ e: 'milestone', m: id, ...base(), secs: visibleSecs(), depth: reached.size })
      return true
    },
    visibility(hidden: boolean) {
      if (hidden) {
        if (hiddenSince === null) hiddenSince = now()
      } else if (hiddenSince !== null) {
        hiddenTotalMs += hiddenSoFar()
        hiddenSince = null
      }
    },
    vrStart() {
      if (closed) return
      sawVr = true
      if (vrStartMs === null) {
        vrStartMs = now()
        emit({ e: 'vr-start', ...base(), secs: visibleSecs() })
      }
    },
    vrEnd(reason: string, fps?: number) {
      if (closed || vrStartMs === null) return
      const secs = Math.max(0, Math.round((now() - vrStartMs) / 1000))
      vrStartMs = null
      emit({ e: 'vr-end', ...base(), secs, reason: reason.slice(0, 32), fps })
    },
    // The page is going away: close an open VR session and record how deep
    // the visit went. Idempotent — pagehide can fire more than once.
    leave(reason: string, fps?: number) {
      if (closed) return
      if (vrStartMs !== null) this.vrEnd(reason, fps)
      emit({
        e: 'leave',
        ...base(),
        secs: visibleSecs(),
        hidden: hiddenSecs(),
        depth: reached.size,
        reason: reason.slice(0, 32),
        fps
      })
      closed = true
    },
    depth: () => reached.size,
    reached: (id: TourEventId) => reached.has(id)
  }
}

export type Recorder = ReturnType<typeof createRecorder>

export type ShipperConfig = {
  endpoint: string
  vid: string
  sid: string
  aud: 'public' | 'dev'
  build: string
  // navigator.sendBeacon-shaped: returns whether the browser queued it.
  send: (url: string, body: string) => boolean
  schedule: (flush: () => void, delayMs: number) => void
}

// Why boot failures need their own path: everything above lives inside the
// app, so a load that dies before the app exists sends nothing at all — and a
// visitor who saw a black screen and left is then indistinguishable in the
// data from one who never arrived. This is the smallest beacon that closes
// that gap, built from the same wire format and sent from the entry point's
// catch block.
export type BootFailureReason = 'webgl' | 'wasm' | 'network' | 'unknown'

// Reads the error, then asks the browser directly. The message is a hint (it
// varies by engine and is often localised); the capability probe is the fact.
export const classifyBootFailure = (
  error: unknown,
  probe: { webgl2: boolean; wasm: boolean }
): BootFailureReason => {
  if (!probe.webgl2) return 'webgl'
  if (!probe.wasm) return 'wasm'

  const text = (
    error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '')
  ).toLowerCase()

  if (text.includes('webgl') || text.includes('context')) return 'webgl'
  if (text.includes('wasm') || text.includes('webassembly')) return 'wasm'
  if (text.includes('fetch') || text.includes('network') || text.includes('load failed')) {
    return 'network'
  }
  return 'unknown'
}

export const probeBootCapabilities = (): { webgl2: boolean; wasm: boolean } => {
  let webgl2 = false
  try {
    webgl2 = document.createElement('canvas').getContext('webgl2') !== null
  } catch {
    webgl2 = false
  }
  return { webgl2, wasm: typeof WebAssembly === 'object' }
}

export type BootFailureConfig = {
  error: unknown
  store: StorageLike | null
  search: string
  build: string
  language: string
  touch: boolean
  referrer: string
  ownHost: string
  probe: { webgl2: boolean; wasm: boolean }
  send: (url: string, body: string) => boolean
  mkId?: () => string
}

// Returns the reason it decided on, or null when the visitor opted out — the
// caller shows the same failure screen either way.
export const reportBootFailure = ({
  error,
  store,
  search,
  build,
  language,
  touch,
  referrer,
  ownHost,
  probe,
  send,
  mkId = randomId
}: BootFailureConfig): BootFailureReason | null => {
  const aud = readAudience(store, search)

  if (aud === 'off') {
    return null
  }

  const reason = classifyBootFailure(error, probe)
  const visitor = readVisitor(store, Date.now(), mkId)
  const body = JSON.stringify({
    v: WIRE_VERSION,
    vid: visitor.id,
    sid: mkId().slice(0, 12),
    aud,
    build,
    events: [
      {
        e: 'boot-fail',
        reason,
        // The tier the app would have used is unknown (quality resolution runs
        // inside the app), so only the facts available at the entry point.
        device: touch ? 'touch' : 'desktop',
        lang: language.slice(0, 16),
        ref: referrerHost(referrer, ownHost),
        visits: visitor.visits,
        days: visitor.days
      }
    ]
  })
  send(METRICS_ENDPOINT, body)
  return reason
}

// Batches events for a couple of seconds so a burst (throw, jump, throw) is one
// request, and flushes synchronously on demand for pagehide.
export const createShipper = ({ endpoint, vid, sid, aud, build, send, schedule }: ShipperConfig) => {
  let queue: MetricsEvent[] = []
  let pending = false
  let sent = 0

  const flush = () => {
    pending = false
    if (queue.length === 0) return
    const events = queue
    queue = []
    const body = JSON.stringify({ v: WIRE_VERSION, vid, sid, aud, build, events })
    if (send(endpoint, body)) sent += events.length
  }

  return {
    emit(event: MetricsEvent) {
      queue.push(event)
      if (event.e === 'leave') {
        flush()
        return
      }
      if (!pending) {
        pending = true
        schedule(flush, 1500)
      }
    },
    flush,
    queued: () => queue.length,
    sent: () => sent
  }
}
