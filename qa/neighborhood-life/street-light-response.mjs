import * as T from 'three'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192', out = fileURLToPath(new URL('.', import.meta.url))
const browser = await chromium.launch({ channel: 'chrome', headless: true }), reports = [], errors = []
try {
 for (const tier of (process.env.TIER ? [process.env.TIER] : ['desktop', 'phone'])) {
  const phone = tier === 'phone', page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: phone, deviceScaleFactor: 1 })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error' && /shader|WebGLProgram/i.test(message.text())) errors.push(message.text()) })
  await page.goto(`${base}/?debug&stats&m=g&a=0&ax=-200&t=.9&tier=${tier}&dpr=1&lock=0`)
  await page.waitForFunction(() => window.__spinwardWalkers.group.userData.people > 0 && window.__spinwardStreetLamps.lighting.slots.some(s => s.light.intensity > 0))
  const chosen = await page.evaluate(() => {
   const rows = [], radius = window.__spinward.radius
   for (const w of window.__spinwardWalkers.walkers) for (const lamp of window.__spinwardStreetLamps.lighting.sources) {
    const r = w.route, la = Math.atan2(lamp.position.z, lamp.position.x)
    const along = r.axis === 'axial' ? lamp.position.y - r.axial : Math.atan2(Math.sin(la - r.azimuth), Math.cos(la - r.azimuth)) * radius
    const offset = Math.max(-r.length / 2 + 6, Math.min(r.length / 2 - 6, along))
    const a = r.azimuth + (r.axis === 'tangent' ? offset / radius : 0), ax = r.axial + (r.axis === 'axial' ? offset : 0)
    const p = lamp.position.clone().set(Math.cos(a) * (radius - 1), ax, Math.sin(a) * (radius - 1))
    rows.push({ route: r, offset, azimuth: a, axial: ax, radius, distance: p.distanceTo(lamp.position), lamp: lamp.id })
   }
   return rows.sort((a, b) => a.distance - b.distance)[0]
  })
  const { route, radius } = chosen
  const a = chosen.azimuth + (route.axis === 'tangent' ? 5 / radius : 0), ax = chosen.axial + (route.axis === 'axial' ? 5 : 0)
  const p = new T.Vector3(Math.cos(a) * (radius - (phone ? 1.6 : 1.8)), ax, Math.sin(a) * (radius - (phone ? 1.6 : 1.8)))
  const target = new T.Vector3(Math.cos(chosen.azimuth) * (radius - 1), chosen.axial, Math.sin(chosen.azimuth) * (radius - 1))
  const q = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(p, target, new T.Vector3(-Math.cos(a), 0, -Math.sin(a))))
  await page.goto(`${base}/?debug&stats&m=g&a=${a}&ax=${ax}&q=${q.toArray()}&t=.9&tier=${tier}&dpr=1&lock=0`)
  await page.waitForSelector('#splash', { state: 'detached' })
  await page.waitForFunction(id => window.__spinwardWalkers.walkers.some(w => w.route.id === id), route.id)
  await page.evaluate(chosen => {
   document.querySelector('.lil-gui')?.remove()
   const scene = window.__spinwardScene, remove = []
   scene.traverse(o => { if (o.renderOrder === 30) remove.push(o) }); remove.forEach(o => o.removeFromParent())
   const walkers = window.__spinwardWalkers, w = walkers.walkers.find(w => w.route.id === chosen.route.id)
   w.clock = (chosen.offset + chosen.route.length / 2) / chosen.route.speed
   const update = walkers.update.bind(walkers); walkers.update = (_dt, ...args) => update(0, ...args)
  }, chosen)
  await page.waitForTimeout(1000)
  const fixture = await page.evaluate(() => {
   const lamps = window.__spinwardStreetLamps, matrix = lamps.heads.mesh.matrix.clone(), p = lamps.group.position.clone()
   return lamps.lighting.slots.map(s => {
    let distance = Infinity
    for (let i = 0; i < lamps.heads.mesh.count; i++) { lamps.heads.mesh.getMatrixAt(i, matrix); p.setFromMatrixPosition(matrix); distance = Math.min(distance, p.distanceTo(s.light.position)) }
    return { id: s.source?.id, intensity: s.light.intensity, headDistance: distance, shadow: s.light.castShadow }
   })
  })
  if (!fixture.some(s => s.intensity > 0) || fixture.some(s => s.intensity > 0 && s.headDistance > .002) || fixture.some(s => s.shadow)) throw Error('Light detached from fixture')
  for (const [index, enabled] of [false, true, true, false].entries()) {
   await page.evaluate(enabled => { for (const s of window.__spinwardStreetLamps.lighting.slots) s.light.visible = enabled }, enabled)
   await page.waitForTimeout(1100)
   if (index < 2) await page.screenshot({ path: out + `street-light-${tier}-${enabled ? 'on' : 'off'}.png` })
   const metrics = await page.evaluate(async frames => {
    const times = []; let last = performance.now()
    for (let i = 0; i < frames; i++) await new Promise(resolve => requestAnimationFrame(t => { if (i) times.push(t - last); last = t; resolve() }))
    times.sort((a, b) => a - b)
    return { median: times[Math.floor(times.length * .5)], p95: times[Math.floor(times.length * .95)], stats: document.querySelector('.stats-overlay')?.textContent }
   }, Number(process.env.FRAMES ?? 181))
   reports.push({ tier, enabled, fixture, chosen, ...metrics }); console.log(JSON.stringify({ tier, enabled, fixture, ...metrics, errors }))
  }
  // Normal travel and a short walk enter the cafe's actual shelter volume.
  await page.evaluate(() => { for (const s of window.__spinwardStreetLamps.lighting.slots) s.light.visible = true })
  if (phone) await page.getByRole('button', { name: 'Travel ▾', exact: true }).click()
  else await page.getByRole('button', { name: 'Places ▾', exact: true }).click()
  await page.locator('.preset-menu:not([hidden])').getByRole('button', { name: 'Café', exact: true }).click()
  await page.waitForTimeout(600)
  await page.keyboard.down('w')
  try { await page.waitForFunction(() => window.__spinward.room.shelter > .95, undefined, { timeout: 10000 }) }
  finally { await page.keyboard.up('w') }
  await page.waitForTimeout(700)
  const indoors = await page.evaluate(() => ({ shelter: window.__spinward.room.shelter, lights: window.__spinwardStreetLamps.lighting.slots.map(s => s.light.intensity) }))
  console.log(JSON.stringify({ tier, indoors }))
  await page.screenshot({ path: out + `street-light-${tier}-indoors.png` })
  if (indoors.shelter < .9 || indoors.lights.some(i => i > .01)) throw Error('Street fixture response persisted indoors')
  reports.push({ tier, indoors })
  await page.close()
 }
 fs.writeFileSync(out + 'street-light-response.json', JSON.stringify({ errors, reports }, null, 2))
 if (errors.length) throw Error(JSON.stringify(errors))
} finally { await browser.close() }
