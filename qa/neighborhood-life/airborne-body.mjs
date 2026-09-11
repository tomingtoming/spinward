import * as T from 'three'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const out = fileURLToPath(new URL('.', import.meta.url)), base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192'
const prefix = process.env.PREFIX ?? 'airborne-body'
const browser = await chromium.launch({ channel: 'chrome', headless: true }), errors = [], reports = []
try {
 for (const tier of ['desktop', 'phone']) {
  const phone = tier === 'phone', position = new T.Vector3(3200 - (phone ? 1.6 : 1.8), -200, 0)
  const q = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(position, new T.Vector3(3199.78, -199.35, 0), new T.Vector3(-1, 0, 0)))
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: phone, deviceScaleFactor: 1 })
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}/?debug&stats&lock=0&m=g&a=0&ax=-200&q=${q.toArray()}&t=.42&tier=${tier}&dpr=1`)
  await page.waitForSelector('#splash', { state: 'detached' })
  await page.waitForFunction(() => window.__spinwardBody.group.userData.ready)
  await page.evaluate(() => {
   document.querySelector('.lil-gui')?.remove(); document.activeElement?.blur()
   window.airBodySamples = []
   window.airBodyTimer = setInterval(() => {
    const b = window.__spinwardBody, c = window.__spinwardScene.getObjectByName('coffee-held').parent
    b.root.updateMatrixWorld(true)
    const toScreen = name => b.root.getObjectByName(name).getWorldPosition(c.position.clone()).applyMatrix4(b.group.parent.matrixWorld).project(c).toArray()
    window.airBodySamples.push({ mode: window.__spinward.mode, visible: b.group.visible, bodyMode: b.group.userData.mode, steps: b.group.userData.steps, feet: b.group.userData.feet, hands: ['left_hand', 'right_hand'].map(toScreen) })
   }, 30)
  })
  await page.screenshot({ path: out + `${prefix}-${tier}-standing.png` })
  await page.keyboard.press('Space')
  for (const [name, wait] of [['lift', 120], ['air', 200], ['fall', 400], ['land', 900], ['settled', 1500]]) {
   await page.waitForTimeout(wait)
   await page.screenshot({ path: out + `${prefix}-${tier}-${name}.png` })
  }
  const jump = await page.evaluate(() => { clearInterval(window.airBodyTimer); return window.airBodySamples })
  const airborne = jump.filter(s => s.mode === 'free-fly')
  if (airborne.length < 4 || airborne.some(s => !s.visible || s.bodyMode !== 'airborne' || s.feet.some(f => f.planted))) throw Error(`${tier}: missing airborne body`)
  if (airborne.some(s => s.steps !== airborne[0].steps)) throw Error(`${tier}: phantom air footsteps`)
  if (jump.at(-1).mode !== 'grounded' || jump.at(-1).bodyMode !== 'standing') throw Error(`${tier}: landing failed`)
  const travel = async name => {
   if (phone) await page.getByRole('button', { name: 'Travel ▾', exact: true }).click()
   await page.getByRole('button', { name, exact: true }).click()
   await page.evaluate(() => document.activeElement?.blur())
   await page.waitForTimeout(800)
  }
  await travel('Axis')
  await page.keyboard.down('q'); await page.waitForTimeout(450); await page.keyboard.up('q')
  await page.waitForTimeout(600)
  await page.screenshot({ path: out + `${prefix}-${tier}-axis-roll.png` })
  const axis = await page.evaluate(() => ({ mode: window.__spinward.mode, body: window.__spinwardBody.group.userData, visible: window.__spinwardBody.group.visible }))
  await travel('Exterior')
  await page.screenshot({ path: out + `${prefix}-${tier}-exterior.png` })
  const exterior = await page.evaluate(() => ({ mode: window.__spinward.mode, body: window.__spinwardBody.group.userData, visible: window.__spinwardBody.group.visible }))
  if ([axis, exterior].some(s => s.mode !== 'free-fly' || !s.visible || s.body.mode !== 'airborne')) throw Error(`${tier}: flight body missing`)
  await travel('Surface')
  const surface = await page.evaluate(() => ({ mode: window.__spinward.mode, body: window.__spinwardBody.group.userData, visible: window.__spinwardBody.group.visible }))
  if (surface.mode !== 'grounded' || surface.body.mode !== 'standing') throw Error(`${tier}: return pose did not restore`)
  reports.push({ tier, jump, axis, exterior, surface })
  console.log(JSON.stringify({ tier, airborneSamples: airborne.length, finalMode: surface.mode, errors }))
  await page.close()
 }
 fs.writeFileSync(out + prefix + '.json', JSON.stringify({ errors, reports }, null, 2))
 if (errors.length) throw Error(JSON.stringify(errors))
} finally { await browser.close() }
