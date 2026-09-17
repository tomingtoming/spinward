import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
const base = process.env.SPINWARD_URL
if (!base) throw Error('SPINWARD_URL required')
const out = process.env.SPINWARD_EVIDENCE_DIR ? resolve(process.env.SPINWARD_EVIDENCE_DIR) : fileURLToPath(new URL('../webxr/evidence/colony-cache-20260918/verified/', import.meta.url)).replace(/\/$/, '')
const saved = JSON.parse(await fs.readFile(out + '/build.json', 'utf8'))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })
  const cdp = await page.context().newCDPSession(page), errors = [], failures = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('requestfailed', r => { if (!r.failure()?.errorText.includes('ERR_ABORTED')) failures.push(r.url()) })
  await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '' }))
  const assets = {}
  for (const path of Object.keys(saved).filter(p => /^assets\/(index-|izmaColony-|worldLandscapes-).*\.js$/.test(p))) {
    const response = await page.request.get(base + '/' + path)
    if (!response.ok()) throw Error('Asset request failed: ' + path)
    const hash = createHash('sha256').update(await response.body()).digest('hex')
    if (hash !== saved[path]) throw Error('Served hash mismatch: ' + path)
    assets[path] = hash
  }
  if (Object.keys(assets).length !== 3) throw Error('Expected fixed main, colony and other-world bundle hashes')
  const cases = []
  for (const visit of ['a-civic', 'b-campus', 'c-market', 'a-civic', 'b-campus-night']) {
    await page.goto(base + '/?debug&metrics=off&lock=0&dpr=1&tier=quest&landscape=authored&preset=izma&t=' + (visit.endsWith('-night') ? '.9' : '.42') + '&visit=' + visit.replace('-night', ''))
    await page.waitForSelector('#splash', { state: 'detached', timeout: 60000 })
    await page.waitForFunction(() => window.__spinwardCity?.authoredColony.group.userData.pending === 0)
    await page.waitForTimeout(1500)
    const state = await page.evaluate(() => {
      const gl = document.querySelector('canvas').getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info')
      return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', colony: window.__spinwardCity.authoredColony.group.userData,
        windowEmission: window.__spinwardCity.authoredColony.group.getObjectsByProperty('isMesh', true).filter(m => m.name.includes('window-')).map(m => ({ name: m.material.emissive.getHexString(), intensity: m.material.emissiveIntensity })) }
    })
    if (/unknown|SwiftShader|Software|llvmpipe/i.test(state.gpu)) throw Error('Hardware GPU required')
    const intensities = state.windowEmission.map(m => m.intensity)
    if (!intensities.length || (visit.endsWith('-night') ? intensities.some(i => i <= 0) : intensities.some(i => i > .01))) throw Error('Live daylight/emission mismatch: ' + visit)
    if (state.colony.collisionCache.entries > 128 || state.colony.collisionCache.bytes > 4 * 1024 * 1024) throw Error('Collision cache exceeds budget')
    const beforeGC = await cdp.send('Runtime.getHeapUsage')
    await cdp.send('HeapProfiler.collectGarbage')
    const afterGC = await cdp.send('Runtime.getHeapUsage')
    cases.push({ visit, state, beforeGC, afterGC })
    console.log(JSON.stringify({ visit, beforeGC, afterGC }))
  }
  const stress = []
  for (let pass = 0; pass < 3; pass++) {
    const cache = await page.evaluate(() => {
      const colony = window.__spinwardCity.authoredColony
      let triangles = 0
      for (const b of colony.getColliders()) if (b.surfaceMesh) triangles += b.surfaceMesh.length / 9
      return { ...colony.group.userData.collisionCache, triangles }
    })
    if (!cache.triangles || cache.entries > 128 || cache.bytes > 4 * 1024 * 1024) throw Error('Collision cache is empty or exceeds budget during full sweep')
    await page.waitForTimeout(500)
    await cdp.send('HeapProfiler.collectGarbage')
    stress.push({ cache, heap: await cdp.send('Runtime.getHeapUsage') })
  }
  console.log(JSON.stringify({ stress }))
  await fs.writeFile(out + '/memory-and-served-build.json', JSON.stringify({ scope: 'Stable page snapshots before/after forced V8 GC; reloads in one page. The additional stress sweeps expand all collider getters in one page; they are cache-pressure checks, not continuous player travel. Not cold-load peak, process/GPU memory or headset measurements.', assets, cases, stress, errors, failures }, null, 2) + '\n')
  if (errors.length || failures.length) throw Error(JSON.stringify({ errors, failures }))
} finally { await browser.close() }
