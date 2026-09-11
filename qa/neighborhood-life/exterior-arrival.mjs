// A/B arrival-side composition without moving light sources or changing materials.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const out = fileURLToPath(new URL('.', import.meta.url)), base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192'
const prefix = process.env.PREFIX ?? 'exterior-arrival'
const browser = await chromium.launch({ channel: 'chrome', headless: true }), errors = [], reports = []
try {
 for (const preset of ['izma', 'cooper', 'elysium', 'playground']) {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}/?debug&stats&lock=0&preset=${preset}&t=.42&dpr=1`)
  await page.waitForSelector('#splash', { state: 'detached' })
  await page.getByRole('button', { name: 'Exterior', exact: true }).click()
  await page.waitForTimeout(2200)
  await page.evaluate(() => {
   document.querySelector('.lil-gui')?.remove()
   window.__spinwardScene.traverse(o => { if (o.renderOrder === 30) o.visible = false })
   const scene = window.__spinwardScene, camera = scene.getObjectByName('coffee-held').parent
   window.exteriorCapture = { camera, world: camera.matrixWorld.clone(), inverse: camera.matrixWorldInverse.clone() }
   scene.onBeforeRender = (_r, _s, active) => { if (active === camera) { camera.matrixWorld.copy(window.exteriorCapture.world); camera.matrixWorldInverse.copy(window.exteriorCapture.inverse) } }
  })
  for (const side of ['original', ...(process.env.COMPARE ? ['sunward'] : [])]) {
   if (side === 'sunward') await page.evaluate(() => {
    const capture = window.exteriorCapture, p = capture.camera.position.clone().setFromMatrixPosition(capture.world)
    p.y = Math.abs(p.y)
    const zero = p.clone().set(0, 0, 0), up = p.clone().set(0, 1, 0)
    capture.world.lookAt(p, zero, up).setPosition(p)
    capture.inverse.copy(capture.world).invert()
   })
   await page.waitForTimeout(250)
   await page.screenshot({ path: out + `${prefix}-${preset}-${side}.png` })
   const report = await page.evaluate(() => ({
    camera: window.exteriorCapture.camera.position.clone().setFromMatrixPosition(window.exteriorCapture.world).toArray(),
    stats: document.querySelector('.stats-overlay')?.textContent,
    lights: (() => { const lights = []; window.__spinwardScene.traverse(o => { if (o.isLight) lights.push({ type: o.type, intensity: o.intensity, position: o.getWorldPosition(o.position.clone()).toArray() }) }); return lights })()
   }))
   reports.push({ preset, side, ...report })
  }
  await page.close()
 }
 fs.writeFileSync(out + prefix + '.json', JSON.stringify({ errors, reports }, null, 2))
 if (errors.length) throw Error(JSON.stringify(errors))
} finally { await browser.close() }
