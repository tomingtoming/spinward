import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import { resolve } from 'node:path'

const out = resolve(process.env.SPINWARD_EVIDENCE_DIR ?? '')
if (!process.env.SPINWARD_EVIDENCE_DIR || !process.env.SPINWARD_URL || !process.env.SPINWARD_BASELINE_URL) throw Error('Evidence directory and both preview URLs required')
await fs.mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const cases = []
try {
  for (let round = 0; round < 3; round++) for (const name of round % 2 ? ['parts', 'inline'] : ['inline', 'parts']) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })
    try {
      const page = await context.newPage(), cdp = await context.newCDPSession(page)
      await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
      await cdp.send('Performance.enable')
      const errors = [], failures = []
      page.on('pageerror', e => errors.push(e.message))
      page.on('requestfailed', r => failures.push({ url: r.url(), error: r.failure()?.errorText }))
      await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '' }))
      const base = name === 'inline' ? process.env.SPINWARD_BASELINE_URL : process.env.SPINWARD_URL
      await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=quest&landscape=authored&preset=izma&t=.42&visit=landscape`, { waitUntil: 'domcontentloaded', timeout: 90000 })
      await page.waitForSelector('#splash', { state: 'detached', timeout: 90000 })
      const splashMs = await page.evaluate(() => performance.now())
      await page.waitForFunction(() => window.__spinwardCity?.authoredColony.group.userData.pending === 0)
      const readyMs = await page.evaluate(() => performance.now())
      await page.waitForTimeout(1000)
      await cdp.send('HeapProfiler.collectGarbage')
      const heap = await cdp.send('Runtime.getHeapUsage')
      const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
      const state = await page.evaluate(() => {
        const gl = document.querySelector('canvas').getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info')
        return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown',
          mode: window.__spinward.mode, groundHeight: window.__spinward.groundHeight,
          colony: window.__spinwardCity.authoredColony.group.userData,
          resources: performance.getEntriesByType('resource').map(r => ({ name: r.name, encoded: r.encodedBodySize, decoded: r.decodedBodySize, ms: r.duration })) }
      })
      if (/unknown|SwiftShader|Software|llvmpipe/i.test(state.gpu)) throw Error('Hardware GPU required: ' + state.gpu)
      if (errors.length || failures.length || state.colony.failed.length || state.colony.loaded > 18 || state.mode !== 'grounded') throw Error(JSON.stringify({ errors, failures, state }))
      if (round === 0) await page.screenshot({ path: resolve(out, name + '.png') })
      const result = { name, round, splashMs, readyMs, heap, scriptSeconds: metrics.ScriptDuration, taskSeconds: metrics.TaskDuration, state, errors, failures }
      cases.push(result)
      await fs.writeFile(resolve(out, 'startup.json'), JSON.stringify({ scope: 'Three cold contexts per format, alternating order, same geometry and app; loopback HTTP, no network throttling; not headset performance.', cases }, null, 2))
      console.log(JSON.stringify({ name, round, splashMs, readyMs, heap, scriptSeconds: metrics.ScriptDuration }))
    } finally { await context.close() }
  }
} finally { await browser.close() }
