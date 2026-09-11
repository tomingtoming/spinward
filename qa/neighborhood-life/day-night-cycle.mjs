// Observe complete default-speed cycles, including the newly shared local
// lamps and star fade. This is continuity evidence, not an FPS benchmark.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as T from 'three'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const out = fileURLToPath(new URL('.', import.meta.url)), base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192'
const prefix = process.env.PREFIX ?? 'day-night-cycle', duration = Number(process.env.DURATION_MS ?? 390000)
const p = new T.Vector3(3198.2, -200, 0), aim = new T.Vector3(3199, -170, 0)
const q = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(p, aim, new T.Vector3(-1, 0, 0)))
const browser = await chromium.launch({ channel: 'chrome', headless: true }), errors = [], captures = []
try {
 const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
 page.on('pageerror', e => errors.push(e.message))
 page.on('console', m => { if (m.type() === 'error' && /shader|WebGLProgram|context.*lost/i.test(m.text())) errors.push(m.text()) })
 await page.goto(`${base}/?debug&lock=0&tier=desktop&dpr=1&t=.4&m=g&a=0&ax=-200&q=${q.toArray()}`)
 await page.waitForSelector('#splash', { state: 'detached' })
 await page.keyboard.press('ArrowUp')
 await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
 await page.waitForTimeout(1000)
 await page.evaluate(() => {
  const scene = window.__spinwardScene, hemi = scene.children.find(o => o.isHemisphereLight)
  const stars = scene.getObjectByName('starfield').children.find(o => o.isPoints)
  const lamps = window.__spinwardStreetLamps.lighting.slots.map(s => s.light)
  if (!hemi || !stars || lamps.length !== 2) throw Error('Missing observed lights')
  const probe = window.__cycleProbe = { active: true, frames: 0, invalid: 0, samples: [], previous: null, min: [Infinity, Infinity, Infinity], max: [0, 0, 0], maxStep: [0, 0, 0], started: performance.now(), lastSample: 0 }
  function frame(now) {
   if (!probe.active) return
   const values = [(hemi.intensity - .22) / .9, stars.material.opacity, Math.max(...lamps.map(l => l.intensity))]
   const state = window.__spinward
   if (!values.every(Number.isFinite) || state.mode !== 'grounded' || !Number.isFinite(state.radial) || Math.abs(state.groundHeight) > .2) probe.invalid++
   values.forEach((v, i) => {
    probe.min[i] = Math.min(probe.min[i], v); probe.max[i] = Math.max(probe.max[i], v)
    if (probe.previous) probe.maxStep[i] = Math.max(probe.maxStep[i], Math.abs(v - probe.previous[i]))
   })
   probe.previous = values; probe.frames++
   if (now - probe.lastSample > 250) {
    probe.samples.push({ elapsed: now - probe.started, values, fog: scene.fog.color.toArray(), background: scene.background.toArray() })
    probe.lastSample = now
   }
   requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
 })
 const started = Date.now()
 do {
  const elapsed = Date.now() - started
  const state = await page.evaluate(() => ({ values: window.__cycleProbe.previous, frames: window.__cycleProbe.frames, invalid: window.__cycleProbe.invalid, controls: !document.querySelector('.controls-card').hidden }))
  const name = `${prefix}-${String(Math.round(elapsed / 1000)).padStart(3, '0')}`
  await page.screenshot({ path: `${out}${name}.png` })
  captures.push({ name, elapsed, ...state }); console.log(JSON.stringify(captures.at(-1)))
  if (elapsed >= duration) break
  await page.waitForTimeout(Math.min(30000, duration - elapsed))
 } while (true)
 const probe = await page.evaluate(() => { window.__cycleProbe.active = false; return window.__cycleProbe })
 fs.writeFileSync(out + prefix + '.json', JSON.stringify({ errors, captures, probe }, null, 2))
 if (errors.length || probe.invalid || probe.min[0] > .03 || probe.max[0] < .97 || probe.min[1] > .03 || probe.max[1] < .85 || probe.max[2] < 10) throw Error('Cycle did not cover stable day/night: ' + JSON.stringify({ errors, ...probe, samples: undefined }))
 if (probe.maxStep[0] > .01 || probe.maxStep[1] > .04 || probe.maxStep[2] > 5) throw Error('Abrupt lighting transition: ' + JSON.stringify(probe.maxStep))
 console.log(JSON.stringify({ frames: probe.frames, range: [probe.min, probe.max], maxStep: probe.maxStep, errors }))
} finally { await browser.close() }
