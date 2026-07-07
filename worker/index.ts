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

type Env = { ASSETS: AssetsFetcher }

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
