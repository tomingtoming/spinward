import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import { resolve } from 'node:path'

if (!process.env.SPINWARD_URL || !process.env.SPINWARD_EVIDENCE_DIR) throw Error('Preview URL and evidence directory required')
const out = resolve(process.env.SPINWARD_EVIDENCE_DIR)
await fs.mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true }), cases = []
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })
  const cdp = await page.context().newCDPSession(page), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '' }))
  for (let round = 0; round < 2; round++) for (const district of ['a-old-town', 'b-housing', 'b-station', 'c-market']) {
    await page.goto(`${process.env.SPINWARD_URL}/?debug&metrics=off&lock=0&dpr=1&tier=quest&landscape=authored&preset=izma&t=.42&visit=public-${district}`)
    await page.waitForSelector('#splash', { state: 'detached', timeout: 60000 })
    await page.waitForFunction(() => window.__spinwardCity?.authoredColony.group.userData.pending === 0)
    await cdp.send('HeapProfiler.collectGarbage')
    const heap = await cdp.send('Runtime.getHeapUsage')
    await page.waitForTimeout(500)
    const frames = await page.evaluate(async () => {
      const intervals = []; let first, last
      await new Promise(resolve => {
        const frame = now => {
          first ??= now
          if (last !== undefined) intervals.push(now - last)
          last = now
          if (now - first < 4000) requestAnimationFrame(frame); else resolve()
        }
        requestAnimationFrame(frame)
      })
      intervals.sort((a, b) => a - b)
      return { samples: intervals.length, median: intervals[Math.floor(intervals.length * .5)], p95: intervals[Math.floor(intervals.length * .95)] }
    })
    const state = await page.evaluate(() => {
      const layer = window.__spinwardCity.authoredColony, colony = layer.group
      const gl = document.querySelector('canvas').getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info')
      let selectedTileTriangles = 0, residentTileBufferBytes = 0
      const detailTiles = []
      for (const tile of colony.children.filter(o => o.name.startsWith('colony-tile-'))) {
        tile.traverseVisible(o => { if (o.geometry) selectedTileTriangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 })
        tile.traverse(o => { if (o.geometry) residentTileBufferBytes += Object.values(o.geometry.attributes).reduce((n, a) => n + a.array.byteLength, 0) + (o.geometry.index?.array.byteLength ?? 0) })
        const id = tile.name.slice('colony-tile-'.length), source = layer.manifest.tiles.find(t => t.id === id)
        detailTiles.push({ id, bounds: source.bounds, visible: tile.visible, level: tile.children.find(c => c.visible)?.name })
      }
      return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', colony: colony.userData,
        lastFrame: { drawCalls: window.__spinwardWatch?.snapshot?.drawCalls, triangles: window.__spinwardWatch?.snapshot?.triangles },
        focus: layer.lastFocus, detailTiles,
        selectedTileTriangles, residentTileBufferBytes }
    })
    if (/unknown|SwiftShader|Software|llvmpipe/i.test(state.gpu)) throw Error('Hardware GPU required')
    if (errors.length || state.colony.failed.length || state.colony.loaded > 18 || state.colony.pending > 3) throw Error(JSON.stringify({ errors, state }))
    cases.push({ round, district, heap, frames, ...state })
    console.log(JSON.stringify({ round, district, heap, frames, lastFrame: state.lastFrame, selectedTileTriangles: state.selectedTileTriangles, residentTileBufferBytes: state.residentTileBufferBytes }))
  }
  await fs.writeFile(resolve(out, 'facade-cost.json'), JSON.stringify({ scope: 'Four centres, two page loads each, forced V8 GC; separate JS heap/backing counters and resident detail buffers. Four seconds of requestAnimationFrame intervals per load on this desktop. Selected tile triangles precede frustum culling. Not total process/GPU memory, peak allocation, long-session eviction or headset performance.', cases, errors }, null, 2))
} finally { await browser.close() }
