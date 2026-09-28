import { chromium } from '@playwright/test'
import { Matrix4, Quaternion, Vector3 } from 'three'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const base = process.env.SPINWARD_URL
if (!base) throw Error('SPINWARD_URL required')
const out = process.env.SPINWARD_EVIDENCE_DIR ? resolve(process.env.SPINWARD_EVIDENCE_DIR, 'desktop') + '/' : fileURLToPath(new URL('../webxr/evidence/colony-runtime-20260917/desktop/', import.meta.url))
await fs.mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = [], failures = [], cases = []
let gpu, incompleteCase = null, complete = false
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => errors.push(e.message))
  page.on('requestfailed', r => { if (!r.failure()?.errorText.includes('ERR_ABORTED')) failures.push(r.url() + ': ' + r.failure()?.errorText) })
  await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '' }))
  const boot = async (query, time) => {
    await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=quest&landscape=authored&preset=izma&t=${time}&${query}`)
    await page.waitForSelector('#splash', { state: 'detached', timeout: 60000 })
    await page.waitForFunction(() => window.__spinwardCity?.authoredColony.group.userData.pending === 0 &&
      (!window.__spinward?.regional || (window.__spinward.regional.state === 'ready' && !window.__spinward.regional.pendingArrival)))
    await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
    if (await page.locator('.tour-notice button').count()) await page.locator('.tour-notice button').first().click()
    await page.waitForTimeout(350)
  }
  const pose = (at, aim, flying = false) => {
    const r = 3200, point = ([x, y, h]) => new Vector3(Math.cos(x / r) * (r - h), y, Math.sin(x / r) * (r - h))
    const q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(point([at[0], at[1], at[2] + 1.8]), point(aim), new Vector3(-Math.cos(at[0] / r), 0, -Math.sin(at[0] / r))))
    return flying ? `m=f&rpm=0&p=${point(at).toArray()}&q=${q.toArray()}` : `m=g&a=${at[0] / r}&ax=${at[1]}&gh=${at[2]}&q=${q.toArray()}`
  }
  const views = [
    ['study', 'visit=landscape'], ['market', 'visit=shops'],
    ['join', pose([-280, -540, 100], [0, -350, 4], true)],
    ['band-a', 'visit=a-civic'], ['band-b', 'visit=b-campus'], ['band-c', 'visit=c-market'],
    ['whole', pose([0, -19500, 2450], [0, 14000, 0], true)],
    ['band-b-overview', pose([6702, -8500, 750], [6702, -7400, 10], true)],
    ['band-c-overview', pose([13404, 1200, 750], [13404, 2800, 10], true)],
  ]
  if (process.env.SPINWARD_EXTRA_VIEWS) views.push(...JSON.parse(process.env.SPINWARD_EXTRA_VIEWS))
  for (const [period, time] of [['day', .42], ['night', .9]]) for (const [name, query] of views) {
    if (process.env.VIEWS && !process.env.VIEWS.split(',').includes(name)) continue
    incompleteCase = { period, name }
    await boot(query, time)
    const state = await page.evaluate(() => {
      const s = window.__spinward, c = window.__spinwardCity
      const gl = document.querySelector('canvas').getContext('webgl2'), d = gl.getExtension('WEBGL_debug_renderer_info')
      return { gpu: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown', mode: s.mode, x: s.azimuth * s.radius, y: s.axial,
        h: s.groundHeight, radial: s.radial, regional: s.regional, colony: c.authoredColony.group.userData, study: c.authoredLandscape.group.userData,
        localLights: window.__spinwardScene.getObjectsByProperty('isPointLight', true)
          .filter(light => light.name.startsWith('landscape-local-light-'))
          .map(light => ({ name: light.name, intensity: light.intensity, distance: light.distance })),
        jsHeap: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null }
    })
    incompleteCase.state = state
    gpu = state.gpu
    if (/unknown|SwiftShader|Software|llvmpipe/i.test(gpu)) throw Error('Hardware GPU required: ' + gpu)
    if (state.localLights.length > 6) throw Error('Local point-light budget exceeded')
    if (state.colony.loaded > 18 || state.colony.pending > 3 || state.colony.failed.length) throw Error('Tile load failure/budget: ' + JSON.stringify(state.colony))
    const frames = await page.evaluate(async () => {
      const times = []; let last, start
      await new Promise(resolve => { const frame = now => { start ??= now; if (last) times.push(now - last); last = now; if (now - start < 1500) requestAnimationFrame(frame); else resolve() }; requestAnimationFrame(frame) })
      times.sort((a, b) => a - b)
      return { samples: times.length, median: times[Math.floor(times.length * .5)], p95: times[Math.floor(times.length * .95)] }
    })
    await page.screenshot({ path: out + period + '-' + name + '.png' })
    cases.push({ period, name, state, frames })
    incompleteCase = null
    console.log(JSON.stringify({ period, name, loaded: state.colony.loaded, h: state.h, frames }))
  }
  if (errors.length || failures.length) throw Error(JSON.stringify({ errors, failures }))
  complete = true
} finally {
  // A late request/capture failure must retain earlier cases and its diagnostics.
  try { await fs.writeFile(out + 'report.json', JSON.stringify({ complete, incompleteCase, gpu, cases, errors, failures }, null, 2)) }
  finally { await browser.close() }
}
