// Long inertial-rest observation: the habitat spins, while fixed stars and
// the colony centre retain their projected directions without user input.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const out = fileURLToPath(new URL('.', import.meta.url)), base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192'
const prefix = process.env.PREFIX ?? 'exterior-rest', duration = Number(process.env.DURATION_MS ?? 190000)
const browser = await chromium.launch({ channel: 'chrome', headless: true }), errors = [], samples = []
try {
 const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
 page.on('pageerror', e => errors.push(e.message))
 page.on('console', m => { if (m.type() === 'error' && /shader|WebGLProgram|context.*lost/i.test(m.text())) errors.push(m.text()) })
 await page.goto(`${base}/?debug&lock=0&tier=desktop&dpr=1&t=.42`)
 await page.waitForSelector('#splash', { state: 'detached' })
 await page.getByRole('button', { name: 'Exterior', exact: true }).click()
 await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
 await page.waitForTimeout(17000)
 await page.evaluate(() => {
  const scene = window.__spinwardScene, camera = scene.getObjectByName('coffee-held').parent
  const stars = scene.getObjectByName('starfield').children.find(o => o.isPoints), positions = stars.geometry.attributes.position
  const indices = []
  for (let i = 0; i < positions.count && indices.length < 5; i++) {
   const p = camera.position.clone().fromBufferAttribute(positions, i).applyMatrix4(stars.matrixWorld).project(camera)
   if (Math.abs(p.x) < .75 && Math.abs(p.y) < .75 && p.z > 0 && p.z < 1) indices.push(i)
  }
  if (indices.length < 5) throw Error('Insufficient visible star probes')
  window.__exteriorSample = () => ({
   mode: window.__spinward.mode, frameAngle: window.__spinward.frameAngle,
   centre: camera.position.clone().set(0, 0, 0).project(camera).toArray(),
   stars: indices.map(i => camera.position.clone().fromBufferAttribute(positions, i).applyMatrix4(stars.matrixWorld).project(camera).toArray()),
   starOpacity: stars.material.opacity, bodyVisible: window.__spinwardBody.group.visible,
   cameraPosition: camera.getWorldPosition(camera.position.clone()).toArray(),
   sun: scene.getObjectByName('sun').getWorldPosition(camera.position.clone()).project(camera).toArray()
  })
 })
 const started = Date.now()
 let nextCapture = 0
 do {
  const elapsed = Date.now() - started, data = await page.evaluate(() => window.__exteriorSample())
  samples.push({ elapsed, ...data })
  if (elapsed >= nextCapture) {
   await page.screenshot({ path: `${out}${prefix}-${String(Math.round(elapsed / 1000)).padStart(3, '0')}.png` })
   nextCapture += 30000
   console.log(JSON.stringify({ elapsed, centre: data.centre, opacity: data.starOpacity, angle: data.frameAngle }))
  }
  if (elapsed >= duration) break
  await page.waitForTimeout(1000)
 } while (true)
 const first = samples[0]
 const drift = samples.reduce((max, s) => ({
  centre: Math.max(max.centre, Math.hypot(s.centre[0] - first.centre[0], s.centre[1] - first.centre[1])),
  stars: Math.max(max.stars, ...s.stars.map((p, i) => Math.hypot(p[0] - first.stars[i][0], p[1] - first.stars[i][1]))),
  opacity: Math.max(max.opacity, Math.abs(s.starOpacity - .6))
 }), { centre: 0, stars: 0, opacity: 0 })
 fs.writeFileSync(out + prefix + '.json', JSON.stringify({ errors, drift, samples }, null, 2))
 console.log(JSON.stringify({ errors, drift, samples: samples.length }))
 if (errors.length || samples.some(s => s.mode !== 'free-fly' || !s.bodyVisible || !s.cameraPosition.every(Number.isFinite))) throw Error('Exterior state failed')
 if (drift.centre > .002 || drift.stars > .002 || drift.opacity > .001) throw Error('Inertial rest drifts: ' + JSON.stringify(drift))
} finally { await browser.close() }
