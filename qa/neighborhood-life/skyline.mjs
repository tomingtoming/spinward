// Frozen-build comparison: real city instances, no synthetic placements.
import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { skylineViews, skylinePose } from './skyline-views.mjs'

const base = process.env.SPINWARD_URL, label = process.env.LABEL ?? 'after', tier = process.env.TIER ?? 'desktop'
if (!base) throw Error('Set SPINWARD_URL to an owned preview')
const output = fileURLToPath(new URL('.', import.meta.url)), evidence = { label, tier, views: [], errors: [] }
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await context.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '', contentType: 'application/javascript' }))
  if (process.env.ASSET_FAILURE === '1') await context.route('**/colony-modules.glb', r => r.abort())
  const page = await context.newPage()
  page.on('pageerror', e => evidence.errors.push(e.message))
  await page.goto('about:blank')
  evidence.gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2'), d = gl?.getExtension('WEBGL_debug_renderer_info')
    if (!d) throw Error('Cannot verify hardware GPU')
    const renderer = gl.getParameter(d.UNMASKED_RENDERER_WEBGL)
    gl.getExtension('WEBGL_lose_context')?.loseContext(); return renderer
  })
  if (/SwiftShader|Software|llvmpipe/i.test(evidence.gpu)) throw Error('Hardware GPU required')
  for (const view of skylineViews.filter(v => !process.env.VIEWS || process.env.VIEWS.split(',').includes(v.name))) {
    const url = `${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&${skylinePose(view)}`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('#splash', { state: 'detached', timeout: 60000 })
    await page.waitForFunction(() => window.__spinwardCity?.colonyBuildings?.group.children.length > 0)
    if (process.env.ASSET_FAILURE !== '1') await page.waitForFunction(() => !!window.__spinwardCity.colonyBuildings.modules)
    await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
    if (await page.locator('.tour-notice button').count()) await page.locator('.tour-notice button').first().click()
    await page.waitForTimeout(1500); await page.keyboard.press('Escape')
    const probe = await page.evaluate(() => {
      const city = window.__spinwardCity, layer = city.colonyBuildings
      const entries = layer.entries.filter(e => !e.interior && ['slab', 'setback'].includes(e.spec.building.kind) &&
        Math.abs(e.spec.building.axial) < 500 && Math.abs(e.spec.building.azimuth) < .2)
      const colliderKey = b => [b.azimuth, b.axial, b.width, b.depth, b.height, b.baseHeight ?? 0].map(n => n.toFixed(6)).join(':')
      const colliders = new Set(city.collisionBuildings.map(colliderKey))
      let matrices = 0, maxMatrixError = 0, collisionParts = 0
      for (const e of entries) for (const v of e.spec.volumes) {
        const b = e.spec.building, side = b.front?.side ?? -1, tangent = b.front?.axis === 'tangent'
        const c = { azimuth: b.azimuth + side * (tangent ? v.z : -v.x) / 3200, axial: b.axial + side * (tangent ? v.x : v.z),
          width: tangent ? v.d : v.w, depth: tangent ? v.w : v.d, height: v.h, baseHeight: v.y - v.h / 2 }
        if (!colliders.has(colliderKey(c))) throw Error('A structural volume is missing from the live collision plan')
        collisionParts++
      }
      for (const e of entries.filter(e => e.visible)) for (const p of e.parts) {
        const mesh = layer.structures.get(p.kind).mesh, actual = mesh.matrix.clone()
        mesh.getMatrixAt(p.slot.index, actual)
        const v = p.volume, local = actual.clone().makeScale(v.w, v.h, v.d).setPosition(v.x, v.y, v.z)
        const expected = e.matrix.clone().multiply(local)
        maxMatrixError = Math.max(maxMatrixError, ...actual.elements.map((a, i) => Math.abs(a - expected.elements[i])))
        matrices++
      }
      return { loaded: !!layer.modules, stats: layer.group.userData, matrices, maxMatrixError, collisionParts,
        samples: entries.map(e => ({ b: e.spec.building, volumes: e.spec.volumes, use: e.design.use.primary })),
        batches: layer.group.children.filter(o => o.visible).map(o => ({ name: o.name, count: o.count,
          triangles: (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 * o.count })) }
    })
    if (!probe.matrices || probe.maxMatrixError > .002) throw Error('Live structural instance differs from its planned volume')
    if (process.env.ASSET_FAILURE === '1' && probe.loaded) throw Error('Expected the GLB failure path')
    const filename = `skyline-${tier}-${label}-${view.name}.png`
    await page.screenshot({ path: output + filename })
    evidence.views.push({ name: view.name, url, file: filename, ...probe })
    console.log(view.name, JSON.stringify({ matrices: probe.matrices, error: probe.maxMatrixError, stats: probe.stats }))
  }
  if (evidence.errors.length) throw Error(evidence.errors.join('\n'))
} finally {
  await fs.writeFile(output + `skyline-${tier}-${label}.json`, JSON.stringify(evidence, null, 2))
  await browser.close()
}
