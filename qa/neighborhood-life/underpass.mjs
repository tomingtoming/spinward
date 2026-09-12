import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { underpassViews, underpassPose } from './underpass-views.mjs'

const base = process.env.SPINWARD_URL, label = process.env.LABEL ?? 'after', tier = process.env.TIER ?? 'desktop'
if (!base) throw Error('Set SPINWARD_URL to an owned preview')
const output = fileURLToPath(new URL('.', import.meta.url)), evidence = { label, tier, views: [], errors: [] }
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await context.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '', contentType: 'application/javascript' }))
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
  for (const view of underpassViews.filter(v => !process.env.VIEWS || process.env.VIEWS.split(',').includes(v.name))) {
    const url = `${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&${underpassPose(view)}`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('#splash', { state: 'detached', timeout: 60000 })
    await page.waitForFunction(() => !!window.__spinwardCity?.colonyBuildings?.modules)
    await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
    if (await page.locator('.tour-notice button').count()) await page.locator('.tour-notice button').first().click()
    await page.waitForTimeout(1800); await page.keyboard.press('Escape')
    const probe = await page.evaluate(() => {
      const city = window.__spinwardCity, layer = city.civicDetails
      const key = c => [c.azimuth, c.axial, c.width, c.depth, c.height, c.baseHeight ?? 0].join(':')
      const active = new Set(city.collisionBuildings.map(key))
      if (layer.colliders.some(c => !active.has(key(c)))) throw Error('Public geometry is absent from the active city collision plan')
      return { underpass: layer.underpass ?? null, stats: layer.group.userData,
        player: window.__spinward, lamps: layer.lamps.map(l => ({ id: l.id, position: l.position.toArray() })),
        colliders: layer.colliders, seats: layer.seats,
        batches: layer.group.children.filter(o => o.isMesh).map(o => ({ triangles: (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 })) }
    })
    if (label !== 'before' && !probe.underpass) throw Error('Missing public underpass plan')
    const filename = `underpass-${tier}-${label}-${view.name}.png`
    await page.screenshot({ path: output + filename })
    evidence.views.push({ name: view.name, url, file: filename, ...probe })
    console.log(view.name, JSON.stringify({ length: probe.underpass?.length, stats: probe.stats }))
  }
  if (process.env.WALK === '1') {
    const p = evidence.views.find(v => v.underpass).underpass
    const snapshot = () => page.evaluate(() => {
      const camera = window.__spinwardScene.getObjectByName('coffee-held').parent
      const eye = camera.getWorldPosition(camera.position.clone())
      return { mode: window.__spinward.mode, a: window.__spinward.azimuth,
        ax: window.__spinward.axial, h: window.__spinward.groundHeight, seat: window.__spinward.room.seat,
        eyeHeight: window.__spinward.radius - Math.hypot(eye.x, eye.z),
        sensor: window.__spinward.room.sensor, body: window.__spinwardBody.group.userData }
    })
    const moveTo = async view => {
      await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=${tier}&${underpassPose({ ...view, ground: true })}`)
      await page.waitForSelector('#splash', { state: 'detached', timeout: 60000 })
      await page.waitForFunction(() => window.__spinwardBody?.group.userData.ready)
      await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
      if (await page.locator('.tour-notice button').count()) await page.locator('.tour-notice button').first().click()
      await page.keyboard.press('Escape'); await page.waitForTimeout(1200)
    }
    const walks = [
      { name: 'middle', x: -15, sign: 1, duration: 6500 },
      { name: 'west-mouth', x: -p.length / 2 + .5, sign: 1, duration: 4000 },
      { name: 'east-mouth', x: p.length / 2 - .5, sign: -1, duration: 4000 },
    ]
    evidence.walks = []
    for (const w of walks) {
      const a = p.azimuth + w.x / 3200
      await moveTo({ at: [a, p.axial, 1.8], aim: [a + w.sign * .015, p.axial, 1.8] })
      const start = await snapshot()
      await page.keyboard.down('KeyW')
      try {
        if (w.name === 'middle') {
          for (let frame = 0; frame < 3; frame++) {
            await page.waitForTimeout(1800)
            await page.screenshot({ path: output + `underpass-${tier}-${label}-moving-${frame}.png` })
          }
        } else await page.waitForTimeout(w.duration)
      } finally { await page.keyboard.up('KeyW') }
      const end = await snapshot(), distance = Math.atan2(Math.sin(end.a - start.a), Math.cos(end.a - start.a)) * 3200 * w.sign
      if (distance < 3 || end.mode !== 'grounded' || Math.abs(end.h - .34) > .03 || Math.abs(end.ax - p.axial) > .15) throw Error('Covered walking route blocked or left its ground: ' + JSON.stringify({ w, start, end, distance }))
      await page.screenshot({ path: output + `underpass-${tier}-${label}-walk-${w.name}.png` })
      evidence.walks.push({ name: w.name, start, end, distance }); console.log('walk', w.name, distance)
    }
    await moveTo({ at: [p.azimuth, p.axial, 1.8], aim: [p.azimuth, p.axial + 5, 1.8] })
    await page.keyboard.down('KeyW')
    try { await page.waitForTimeout(3000) } finally { await page.keyboard.up('KeyW') }
    evidence.railStop = await snapshot()
    if (evidence.railStop.ax > p.axial + p.rail.y - .3 || evidence.railStop.ax < p.axial + .4 || Math.abs(evidence.railStop.h - .34) > .03) throw Error('Walked through or climbed the guardrail: ' + JSON.stringify(evidence.railStop))
    evidence.benches = []
    for (const seat of evidence.views[0].seats.filter(s => s.id.startsWith('underpass-'))) {
      await moveTo({ at: [seat.azimuth, seat.exit.axialPosition, 1.8], aim: [seat.azimuth, seat.axialPosition - .18, .8] })
      await page.keyboard.press('KeyE')
      await page.waitForFunction(id => window.__spinward.room.seat === id, seat.id)
      await page.keyboard.down('ArrowDown')
      try { await page.waitForTimeout(850) } finally { await page.keyboard.up('ArrowDown') }
      const sitting = await snapshot()
      if (!sitting.sensor || sitting.body.mode !== 'seated' || Math.abs(sitting.eyeHeight - seat.seatHeight - .7) > .03) throw Error('Seat input did not attach the player at the bench height')
      await page.screenshot({ path: output + `underpass-${tier}-${label}-${seat.id}-seated.png` })
      await page.keyboard.press('KeyE')
      await page.waitForFunction(() => !window.__spinward.room.seat)
      await page.waitForTimeout(600)
      const standing = await snapshot()
      if (standing.sensor || Math.abs(standing.ax - seat.exit.axialPosition) > .06 || Math.abs(standing.h - .34) > .03) throw Error('Invalid bench exit: ' + JSON.stringify(standing))
      evidence.benches.push({ id: seat.id, sitting, standing }); console.log('bench', seat.id, 'sit/stand')
    }
  }
  if (evidence.errors.length) throw Error(evidence.errors.join('\n'))
} finally {
  await fs.writeFile(output + `underpass-${tier}-${label}.json`, JSON.stringify(evidence, null, 2))
  await browser.close()
}
