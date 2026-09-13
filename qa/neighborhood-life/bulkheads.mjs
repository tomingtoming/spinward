import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { bulkheadViews, bulkheadPose } from './bulkhead-views.mjs'
const base = process.env.SPINWARD_URL, label = process.env.LABEL ?? 'after', tier = process.env.TIER ?? 'desktop'
if (!base) throw Error('SPINWARD_URL required')
const out = fileURLToPath(new URL('.', import.meta.url)), report = { label, tier, views: [], errors: [] }
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => report.errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()) })
  await page.goto('about:blank')
  report.gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2'), d = gl?.getExtension('WEBGL_debug_renderer_info')
    if (!d) throw Error('GPU unknown')
    const r = gl.getParameter(d.UNMASKED_RENDERER_WEBGL); gl.getExtension('WEBGL_lose_context')?.loseContext(); return r
  })
  if (/SwiftShader|Software|llvmpipe/i.test(report.gpu)) throw Error('Hardware GPU required')
  await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '', contentType: 'application/javascript' }))
  for (const v of bulkheadViews.filter(v => !process.env.VIEW || v.name === process.env.VIEW)) {
    await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&${bulkheadPose(v)}`)
    await page.waitForSelector('#splash', { state: 'detached', timeout: 60000 })
    await page.waitForFunction(() => window.__spinwardScene)
    await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
    if (await page.locator('.tour-notice button').count()) await page.locator('.tour-notice button').first().click()
    await page.keyboard.press('Escape'); await page.waitForTimeout(1200)
    const state = await page.evaluate(() => {
      const scene = window.__spinwardScene, all = []; scene.traverse(o => { if (o.isMesh && o.material.roughness === .78 && o.material.metalness === .24) all.push(o) })
      return { player: window.__spinward, asset: document.querySelector('script[src*="/assets/"]').src,
        caps: all.map(o => ({ name: o.name, triangles: (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3,
          map: o.material.map?.image.width ?? null, emissive: o.material.emissiveIntensity, matrix: o.matrixWorld.elements,
          ...(o.material.emissiveMap ? { litPixels: (() => { const c = o.material.emissiveMap.image, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] || d[i + 1] || d[i + 2]) n++; return n })() } : {}) })) }
    })
    if (Math.abs(state.player.axial - v.at[1]) > .01 || Math.abs(state.player.radial - Math.hypot(v.at[0], v.at[2])) > .01) throw Error('URL fixture position was clamped or moved')
    const file = `bulkheads-${tier}-${label}-${v.name}.png`; await page.screenshot({ path: out + file })
    report.views.push({ name: v.name, file, url: page.url(), ...state })
    if (label !== 'before') {
      if (v.open && state.caps.some(c => c.name === 'bulkhead-disks')) throw Error('Open ring was capped')
      if (!v.open && !state.caps.some(c => c.name === 'bulkhead-disks' && c.litPixels === 0)) throw Error('Missing opaque non-emitting bulkhead')
      if (!state.caps.some(c => c.name === 'end-cap-frames' && c.map === null && c.emissive === 0)) throw Error('Frame contains a stretched wall decal')
    }
    console.log(v.name, JSON.stringify(state.caps.map(c => ({ name: c.name, triangles: c.triangles, litPixels: c.litPixels }))))
  }
  if (report.errors.length) throw Error(report.errors.join('\n'))
} finally { await fs.writeFile(out + `bulkheads-${tier}-${label}.json`, JSON.stringify(report, null, 2)); await browser.close() }
