import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { riverPose, riverOrigin, riverViews } from './river-views.mjs'

const base = process.env.SPINWARD_URL, tier = process.env.TIER ?? 'desktop', label = process.env.LABEL ?? 'final'
if (!base) throw Error('SPINWARD_URL required')
const out = fileURLToPath(new URL('.', import.meta.url)), prefix = `river-directions-${tier}-${label}`
const report = { tier, label, views: [], walk: [], errors: [] }
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => report.errors.push(e.message))
  await page.goto('about:blank')
  report.gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2'), d = gl?.getExtension('WEBGL_debug_renderer_info')
    if (!d) throw Error('Cannot verify GPU')
    const r = gl.getParameter(d.UNMASKED_RENDERER_WEBGL); gl.getExtension('WEBGL_lose_context')?.loseContext(); return r
  })
  if (/SwiftShader|Software|llvmpipe/i.test(report.gpu)) throw Error('Hardware GPU required')
  await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '', contentType: 'application/javascript' }))
  const open = async v => {
    await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&${riverPose(v)}`)
    await page.waitForSelector('#splash', { state: 'detached', timeout: 60000 })
    await page.waitForFunction(() => window.__spinwardOuting?.destinations.has('guide-river') && window.__spinwardCity.riverLayer.group.userData.blenderReady)
    await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
    if (await page.locator('.tour-notice button').count()) await page.locator('.tour-notice button').first().click()
    await page.keyboard.press('Escape'); await page.waitForTimeout(800)
  }
  // Read position and heading only; steering and walking use real keys.
  const state = () => page.evaluate(() => {
    const s = window.__spinward, c = window.__spinwardCity, camera = window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera', true)[0]
    const v = camera.position.clone(); camera.getWorldDirection(v).transformDirection(c.group.matrixWorld.clone().invert())
    return { a: s.azimuth, ax: s.axial, h: s.groundHeight, mode: s.mode, outing: s.outing,
      heading: Math.atan2(-Math.sin(s.azimuth) * v.x + Math.cos(s.azimuth) * v.z, v.y),
      target: window.__spinwardOuting.journey.points[s.outing.index] }
  })
  const shot = async name => {
    const file = `${prefix}-${name}.png`; await page.screenshot({ path: out + file })
    report.views.push({ name, file, url: page.url(), state: await state() })
  }
  const directions = async () => {
    const before = await state()
    await page.getByRole('button', { name: 'Places', exact: true }).click()
    await page.getByRole('button', { name: 'Directions to Riverside', exact: true }).click()
    await page.waitForFunction(() => window.__spinward.outing.action === 'guide-river' && window.__spinward.outing.status === 'active')
    const after = await state()
    if (Math.hypot((after.a - before.a) * 3200, after.ax - before.ax) > .15 || Math.abs(after.h - before.h) > .05) throw Error('Directions moved the player')
    return page.evaluate(() => window.__spinwardOuting.journey.points)
  }
  const start = { at: [0, 4.65, 7.14], aim: [25, 11, 7.14], ground: true, h: 5.34 }
  await open(start)
  report.asset = await page.locator('script[src*="/assets/"]').getAttribute('src')
  report.route = await directions()
  if (!report.route.some(p => p.riverWalk === 'ramp') || !report.route.some(p => p.groundHeight < 1.21)) throw Error('Missing lower bank route')
  await shot('bridge-start')
  if (process.env.WALK === '1') {
    if (process.env.RAMP_ONLY === '1') {
      report.bridgeRoute = report.route
      const x = 9 * Math.sin(96 / 62) + 21
      await open({ at: [x, 96, 6.94], aim: [x, 102, 6.94], ground: true, h: 5.14 })
      report.route = await directions(); await shot('ramp-start')
    }
    const deadline = Date.now() + 240000, seen = new Set(), startState = await state()
    let bestIndex = -1, closest = Infinity, progressAt = Date.now()
    try {
      while (Date.now() < deadline) {
        const s = await state(); report.walk.push(s)
        if (s.outing.status === 'arrived') break
        if (s.mode !== 'grounded' || s.outing.status !== 'active') throw Error('Lost supported route ' + JSON.stringify(s))
        const g = s.target, dx = (g.azimuth - s.a) * 3200, dy = g.axial - s.ax, distance = Math.hypot(dx, dy)
        if (s.outing.index !== bestIndex || distance < closest - .1) {
          closest = distance; bestIndex = s.outing.index; progressAt = Date.now()
        }
        if (Date.now() - progressAt > 8000) throw Error('Walking stalled ' + JSON.stringify(s))
        const error = Math.atan2(Math.sin(Math.atan2(dx, dy) - s.heading), Math.cos(Math.atan2(dx, dy) - s.heading))
        if (Math.abs(error) > .05) {
          await page.keyboard.up('KeyW')
          const key = error > 0 ? 'ArrowRight' : 'ArrowLeft'
          await page.keyboard.down(key); await page.waitForTimeout(Math.min(200, Math.max(20, Math.abs(error) / 1.4 * 900))); await page.keyboard.up(key)
        } else { await page.keyboard.down('KeyW'); await page.waitForTimeout(100) }
        if (!seen.has(g.riverWalk) && ['upper', 'ramp', 'bank'].includes(g.riverWalk)) {
          seen.add(g.riverWalk); await page.keyboard.up('KeyW'); await shot(g.riverWalk)
          console.log('reached', g.riverWalk, JSON.stringify(s))
        }
      }
    } finally { await page.keyboard.up('KeyW'); await page.keyboard.up('ArrowLeft'); await page.keyboard.up('ArrowRight') }
    report.end = await state(); report.start = startState
    if (report.end.outing.status !== 'arrived' || Math.abs(report.end.h - 1.2) > .05 || !seen.has('ramp')) throw Error('Did not arrive on the lower bank')
    await shot('arrived')
  }
  await page.locator('.outing-panel').getByRole('button', { name: 'Cancel directions' }).click()
  await page.waitForFunction(() => window.__spinward.outing.action === null)
  await open({ ...start, phase: .02 }); await directions(); await shot('night')
  await page.setViewportSize({ width: 390, height: 844 }); await shot('phone-directions')
  await page.getByRole('button', { name: 'Places', exact: true }).click(); await shot('phone-places')
  const button = page.getByRole('button', { name: 'Go now to Riverside', exact: true })
  await button.click(); await page.waitForFunction(() => Math.abs(window.__spinward.groundHeight - 1.2) < .03)
  report.visit = await state()
  const box = await page.locator('.outing-panel').boundingBox()
  if (box && (box.x < 0 || box.x + box.width > 391)) throw Error('Phone panel overflows')
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const side of [-1, 1]) for (const bank of [-1, 1]) {
    const y = side * 12, x = 9 * Math.sin(y / 62) + bank * 21
    await open({ at: [x, y, 12], aim: [x, y - side * 10, 5.3] }); await shot(`junction-${bank}-${side}`)
    const end = side * 100, crossing = 9 * Math.sin(end / 62) + bank * 18.5
    await open({ at: [crossing + bank * 7, end + side * 5, 10], aim: [crossing, end, 5.07] }); await shot(`ramp-connection-${bank}-${side}`)
  }
  await open(riverViews.find(v => v.name === 'far')); await shot('far')
  report.stats = await page.evaluate(() => window.__spinwardCity.riverLayer.group.userData)
  if (report.stats.bridgeLod !== 2) throw Error('Far bridge LOD changed')
  if (report.errors.length) throw Error(report.errors.join('\n'))
  console.log(JSON.stringify({ gpu: report.gpu, views: report.views.length, walkSamples: report.walk.length, end: report.end, errors: report.errors }))
} finally { await fs.writeFile(out + `${prefix}.json`, JSON.stringify(report, null, 2)); await browser.close() }
