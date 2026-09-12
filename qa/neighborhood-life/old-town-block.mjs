// Frozen-build visual comparison. Floating inspection views use zero spin;
// the alley walk below uses ordinary grounded input and the preset's spin.
import { chromium } from '@playwright/test'
import { Matrix4, Quaternion, Vector3 } from 'three'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192'
const label = process.env.LABEL ?? 'after', tier = process.env.TIER ?? 'desktop'
const output = fileURLToPath(new URL('.', import.meta.url)), evidence = { label, tier, views: [], errors: [] }
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await context.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '', contentType: 'application/javascript' }))
if (process.env.ASSET_FAILURE === '1') await context.route('**/old-town-services.glb', r => r.abort())
const page = await context.newPage()
page.on('pageerror', e => evidence.errors.push(e.message))
const point = (a, ax, h) => new Vector3(Math.cos(a) * (3200 - h), ax, Math.sin(a) * (3200 - h))
const pose = (at, aim, flight) => {
  const p = point(...at), q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(p, point(...aim), new Vector3(-Math.cos(at[0]), 0, -Math.sin(at[0]))))
  return `${flight ? `m=f&rpm=0&p=${p.toArray()}` : `m=g&a=${at[0]}&ax=${at[1]}`}&q=${q.toArray()}`
}
try {
  await page.goto('about:blank')
  evidence.gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2'), d = gl?.getExtension('WEBGL_debug_renderer_info')
    if (!d) throw Error('Cannot verify hardware GPU')
    const renderer = gl.getParameter(d.UNMASKED_RENDERER_WEBGL); gl.getExtension('WEBGL_lose_context')?.loseContext(); return renderer
  })
  if (/SwiftShader|Software|llvmpipe/i.test(evidence.gpu)) throw Error('Hardware GPU required')
  const square = -17349.677419354837
  const views = [
    { name: 'arrival', at: [0, square - 4, 1.8], aim: [.021, square - 60, 8], flight: false },
    { name: 'back-lane', at: [.0194, square - 57, 1.8], aim: [.0194, square - 89, 5], flight: false },
    { name: 'services', at: [.0225, -17418.5, 1.6], aim: [.02223, -17421.91, .6], flight: true },
    { name: 'outlook', at: [.019394, -17420.5, 1.8], aim: [.019394, square + 20, 9], flight: false },
    { name: 'roof', at: [.0186, square - 88, 21], aim: [.0194, square - 76, 20], flight: true },
    { name: 'roof-access', at: [.01939436514508575, -17432.8, 20], aim: [.01939436514508575, -17440.5, 19.7], flight: true },
    { name: 'roof-walk', at: [.01939436514508575, -17432.8, 20], aim: [.01939436514508575, -17440.5, 19.7], flight: false, groundHeight: 18.219320999022212 },
    { name: 'roof-night', at: [.01939436514508575, -17432.8, 20], aim: [.01939436514508575, -17440.5, 19.7], flight: true, phase: .02 },
    { name: 'plant-room', at: [.05299, -17377.7, 39], aim: [.05299, -17385.35, 38.8], flight: true },
    { name: 'plant-side', at: [.0540, -17383.2, 39.3], aim: [.05299, -17385.35, 38.6], flight: true },
    { name: 'plant-plan', at: [.05334, -17381.3, 45], aim: [.0532, -17383, 37.5], flight: true },
    { name: 'laundry', at: [.02163, -17473.82, 17], aim: [.02092, -17482.3, 15.5], flight: true },
    { name: 'block', at: [-.022, square + 20, 80], aim: [.030, square - 90, 15], flight: true },
    { name: 'distant', at: [-.100, square + 80, 150], aim: [.030, square - 90, 15], flight: true },
    { name: 'distant-night', at: [-.100, square + 80, 150], aim: [.030, square - 90, 15], flight: true, phase: .02 },
    { name: 'entry-day', at: [.0194, -17417.5, 1.8], aim: [.01963, -17421.9, 1.65], flight: false },
    { name: 'entry-night', at: [.0194, -17417.5, 1.8], aim: [.01963, -17421.9, 1.65], flight: false, phase: .02 },
    { name: 'night', at: [.0194, square - 57, 1.8], aim: [.0194, square - 89, 7], flight: false, phase: .02 },
  ]
  for (const view of views.filter(v => !process.env.VIEWS || process.env.VIEWS.split(',').includes(v.name))) {
    const url = `${base}/?debug&lock=0&metrics=off&tier=${tier}&dpr=1&t=${view.phase ?? .42}&${pose(view.at, view.aim, view.flight)}${view.groundHeight === undefined ? '' : `&gh=${view.groundHeight}`}`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('#splash', { state: 'detached', timeout: 60000 })
    await page.waitForFunction(() => window.__spinwardBody?.group.userData.ready)
    await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
    if (label !== 'before' && process.env.ASSET_FAILURE !== '1') await page.waitForFunction(() => window.__spinwardCity.oldTownBlock?.group.userData.ready)
    if (await page.locator('.tour-notice button').count()) await page.locator('.tour-notice button').first().click()
    await page.waitForTimeout(1800)
    await page.keyboard.press('Escape')
    const stats = await page.evaluate(() => ({ state: window.__spinward, details: window.__spinwardCity.oldTownBlock?.group.userData,
      batches: window.__spinwardCity.oldTownBlock?.group.children.filter(o => o.visible).map(o => ({ name: o.name, count: o.count ?? 1, triangles: (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 * (o.count ?? 1) })) }))
    const filename = `old-town-${tier}-${label}-${view.name}.png`
    await page.screenshot({ path: output + filename })
    evidence.views.push({ name: view.name, url, file: filename, ...stats })
    if (label !== 'before') {
      const alignment = await page.evaluate(() => {
        const layer = window.__spinwardCity.oldTownBlock
        let checked = 0
        for (const mesh of layer.group.children.filter(o => o.isInstancedMesh && o.visible)) {
          for (let i = 0; i < mesh.count; i++) {
            const matrix = mesh.matrix.clone(); mesh.getMatrixAt(i, matrix)
            let owner = null
            for (const e of layer.entries) {
              const local = e.matrix.clone().invert().multiply(matrix), m = local.elements
              const part = e.parts.find(p => {
                const module = mesh.name.replace('old-town-', '').replace('_lod', '').replace(/^(wash|diffuser)$/, 'box')
                const y = p.y + (p.module !== 'box' && module === 'box' ? p.h / 2 : 0)
                return (module === p.module || module === 'box') && Math.hypot(m[12] - p.x, m[13] - y, m[14] - p.z) < .003
              })
              if (part) { owner = part; break }
            }
            if (!owner) throw Error('An Old Town instance has no matching wall/roof attachment')
            checked++
          }
        }
        if (checked !== layer.group.userData.visibleParts) throw Error('Instance budget counter disagrees with actual buffers')
        const colliders = layer.getColliders()
        const actual = window.__spinwardCity.collisionBuildings
        if (!colliders.every(c => actual.some(a => Math.abs(a.azimuth - c.azimuth) < 1e-9 && Math.abs(a.axial - c.axial) < 1e-6 && a.baseHeight === c.baseHeight && a.height === c.height))) throw Error('Rooftop collider missing from the city collision plan')
        return { checked, colliders: colliders.length }
      })
      evidence.views.at(-1).alignment = alignment
    }
    console.log(view.name, JSON.stringify(stats.details ?? {}))
    if (process.env.ASSET_FAILURE === '1' && (stats.details?.ready || !stats.details?.visibleRoofParts)) throw Error('Asset failure must retain roof silhouettes')
    if (view.name === 'back-lane') {
      const start = await page.evaluate(() => window.__spinward)
      await page.keyboard.down('KeyW'); await page.waitForTimeout(2200); await page.keyboard.up('KeyW')
      evidence.walk = { start, end: await page.evaluate(() => window.__spinward) }
    }
    if (view.name === 'roof-walk') {
      const start = await page.evaluate(() => window.__spinward)
      await page.keyboard.down('KeyW')
      try { await page.waitForTimeout(6500) } finally { await page.keyboard.up('KeyW') }
      const end = await page.evaluate(() => window.__spinward)
      evidence.roofWalk = { start, end }
      if (start.mode !== 'grounded' || end.mode !== 'grounded' || Math.abs(end.groundHeight - view.groundHeight) > .05 ||
          start.axial - end.axial < 4 || end.axial < -17438.7 || end.axial > -17437.8) throw Error('Roof walk must remain on the roof and stop in front of the closed stairwell')
      await page.screenshot({ path: output + `old-town-${tier}-${label}-roof-stop.png` })
    }
  }
  if (process.env.WALK === '1') {
    const at = [.01939436514508575, -17358, 1.8], aim = [at[0], -17430, 1.8]
    await page.goto(`${base}/?debug&lock=0&metrics=off&tier=desktop&dpr=1&t=.42&${pose(at, aim, false)}`)
    await page.waitForSelector('#splash', { state: 'detached' })
    await page.waitForFunction(() => window.__spinwardCity.oldTownBlock?.group.userData.ready)
    await page.getByRole('button', { name: 'Dismiss guide' }).click()
    const start = await page.evaluate(() => window.__spinward)
    await page.keyboard.down('KeyW')
    try { await page.waitForTimeout(26000) } finally { await page.keyboard.up('KeyW') }
    const end = await page.evaluate(() => window.__spinward)
    evidence.courtWalk = { start, end, distance: start.axial - end.axial }
    if (end.mode !== 'grounded' || end.axial > -17403.7 || end.axial < -17422 || Math.abs(end.azimuth - at[0]) * 3200 > .5) throw Error('The street-to-court walk was blocked or left its route')
    await page.screenshot({ path: output + `old-town-${tier}-${label}-walk.png` })
  }
  if (evidence.errors.length) throw Error(evidence.errors.join('\n'))
} finally {
  await fs.writeFile(output + `old-town-${tier}-${label}.json`, JSON.stringify(evidence, null, 2))
  await context.close(); await browser.close()
}
