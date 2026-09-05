import { buildShareCard } from '../src/app/shareCard'

// Edge worker for dynamic OGP: a share link pasted on X/Discord unfurls with
// THIS view's title/description (felt g at the spot, altitude, hour, weather)
// instead of the one static pitch. Everything else — every asset, and the
// root page without share params — passes straight through to static assets.
//
// wrangler.jsonc routes only "/" through here (assets.run_worker_first), so
// hashed assets keep their zero-Worker fast path. The share codec itself
// lives in src/app/shareLink.ts and is imported, not duplicated.
//
// Groundwork note: the og:image stays the static og.jpg for now. When a
// per-view image lands, generate its URL from the same buildShareCard inputs
// and rewrite og:image/twitter:image below the same way.

// Minimal runtime types so the app's tsconfig (DOM lib) accepts this file
// without pulling in @cloudflare/workers-types.
type AssetsFetcher = { fetch: (request: Request) => Promise<Response> }

// Workers Analytics Engine dataset (wrangler.jsonc analytics_engine_datasets).
// Optional so a deploy without the binding (or a local preview) degrades to
// "accept and drop" instead of throwing on every visit.
type AnalyticsEngineDataset = {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void
}

type Env = { ASSETS: AssetsFetcher; PLAY?: AnalyticsEngineDataset }

type CfRequest = Request & { cf?: { country?: string } }

// ── /metric: usage funnel sink (src/app/metrics.ts POSTs here) ──────────────
// One Analytics Engine data point per event. Column layout is the contract
// with docs/metrics.md (the SQL there indexes blobs/doubles by position).
// A blob must be a bounded string and a double a finite number or the write
// throws and the row is lost, so everything is sanitized here.
//
//   index1   visitor id (random, localStorage; the sampling key)
//   blob1    event    'session' | 'milestone' | 'vr-start' | 'vr-end' | 'leave'
//   blob2    milestone id (tourGuide event id; 'milestone' rows only)
//   blob3    preset   'izma' | 'playground' | 'cooper' | 'elysium' | 'custom'
//   blob4    entry    'landing' | 'shared' (followed a share link)
//   blob5    device   'desktop' | 'touch' | 'vr'
//   blob6    lang
//   blob7    referrer host ('session' only)
//   blob8    reason   ('leave' / 'vr-end')
//   blob9    audience 'public' | 'dev'
//   blob10   sid      page-load id (groups one visit's rows)
//   blob11   build    client build id
//   blob12   host     SERVER: request hostname (prod vs staging)
//   blob13   country  SERVER: request.cf.country
//   blob14   tier     quality tier 'desktop' | 'quest' | 'phone'
//   double1  secs     visible seconds since load (milestone / leave) or VR seconds (vr-end)
//   double2  visits   this browser's visit count (1 = first ever, 0 = storage denied)
//   double3  days     days since first visit
//   double4  hidden   seconds the tab was hidden ('leave'; already subtracted from secs)
//   double5  depth    distinct milestones reached so far
//   double6  fps      average fps ('vr-end' / 'leave' when the meter has one)
const str = (v: unknown, n = 64) => (typeof v === 'string' ? v : '').slice(0, n)
const num = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

// 'boot-fail' comes from the entry point's catch block, not the recorder: a
// load that dies before the app exists would otherwise be invisible, and
// "saw a black screen and left" would read exactly like "never visited".
export const EVENT_NAMES = new Set([
  'session',
  'milestone',
  'vr-start',
  'vr-end',
  'leave',
  'boot-fail'
])

export const metric = async (request: CfRequest, env: Env): Promise<Response> => {
  if (request.method !== 'POST') {
    return new Response('POST only', { status: 405, headers: { Allow: 'POST' } })
  }
  const url = new URL(request.url)
  const origin = request.headers.get('Origin')
  if (origin && origin !== url.origin) {
    return new Response(null, { status: 403 })
  }
  let text = ''
  try {
    text = await request.text()
  } catch {
    return new Response(null, { status: 400 })
  }
  if (text.length > 8192) return new Response(null, { status: 413 })
  let batch: { vid?: unknown; sid?: unknown; aud?: unknown; build?: unknown; events?: unknown } | null = null
  try {
    batch = JSON.parse(text)
  } catch {
    batch = null
  }
  if (!batch || !Array.isArray(batch.events)) {
    return new Response(null, { status: 400 })
  }
  if (!env.PLAY) return new Response(null, { status: 204 })

  const vid = str(batch.vid) || 'anon'
  const sid = str(batch.sid, 32)
  const audience = batch.aud === 'dev' ? 'dev' : 'public'
  const build = str(batch.build, 24)
  const host = url.hostname
  const country = String(request.cf?.country ?? '').slice(0, 8)
  let written = 0
  for (const raw of (batch.events as unknown[]).slice(0, 20)) {
    if (!raw || typeof raw !== 'object') continue
    const ev = raw as Record<string, unknown>
    const name = str(ev.e, 24)
    if (!EVENT_NAMES.has(name)) continue
    try {
      env.PLAY.writeDataPoint({
        indexes: [vid],
        blobs: [
          name,
          str(ev.m, 24),
          str(ev.preset, 24),
          str(ev.entry, 16),
          str(ev.device, 8),
          str(ev.lang, 16),
          str(ev.ref),
          str(ev.reason, 32),
          audience,
          sid,
          build,
          host,
          country,
          str(ev.tier, 16)
        ],
        doubles: [num(ev.secs), num(ev.visits), num(ev.days), num(ev.hidden), num(ev.depth), num(ev.fps)]
      })
      written++
    } catch (error) {
      // A counter must never fail quietly: a dataset that stopped receiving
      // reads exactly like nobody visiting. observability is on, so this
      // lands in Workers Logs.
      console.error('[metric] writeDataPoint failed:', String((error as Error)?.message ?? error))
    }
  }
  // One line per batch — the only way to tell a live pipeline from a dead one
  // without an Analytics Engine read.
  console.log('[metric]', JSON.stringify({ n: written, host, cc: country, aud: audience, build }))
  return new Response(null, { status: 204 })
}

type RewriterElement = {
  setAttribute(name: string, value: string): void
  setInnerContent(content: string): void
}

declare class HTMLRewriter {
  on(
    selector: string,
    handlers: { element(element: RewriterElement): void }
  ): HTMLRewriter
  transform(response: Response): Response
}

// The params that make a URL a SHARED VIEW rather than the landing page.
const SHARE_PARAMS = ['m', 'q', 't', 'rpm', 'r', 'len', 'rain', 'preset']

const setContent = (value: string) => ({
  element(element: RewriterElement) {
    element.setAttribute('content', value)
  }
})

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/metric') {
      return metric(request as CfRequest, env)
    }
    const assetResponse = await env.ASSETS.fetch(request)

    const isShareView =
      url.pathname === '/' &&
      SHARE_PARAMS.some((param) => url.searchParams.has(param))

    if (!isShareView || !assetResponse.ok) {
      return assetResponse
    }

    const card = buildShareCard(url.search)

    const rewritten = new HTMLRewriter()
      .on('title', {
        element(element) {
          element.setInnerContent(card.title)
        }
      })
      .on('meta[property="og:title"]', setContent(card.title))
      .on('meta[name="twitter:title"]', setContent(card.title))
      .on('meta[property="og:description"]', setContent(card.description))
      .on('meta[name="twitter:description"]', setContent(card.description))
      .on('meta[property="og:url"]', setContent(url.toString()))
      .transform(assetResponse)

    // The asset's validators describe the UNMODIFIED body; drop them so a
    // cached 304 can never resurrect the generic card for a share URL.
    const headers = new Headers(rewritten.headers)
    headers.delete('ETag')
    headers.delete('Last-Modified')

    return new Response(rewritten.body, {
      status: rewritten.status,
      statusText: rewritten.statusText,
      headers
    })
  }
}
