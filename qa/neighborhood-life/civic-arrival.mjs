import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as T from 'three'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const out = fileURLToPath(new URL('.', import.meta.url)), base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = [], reports = []
try {
  for (const phone of [false, true]) {
    const page = await browser.newPage({ ignoreHTTPSErrors: true, hasTouch: phone, viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 } })
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', m => { if (m.type() === 'error' && /shader|WebGLProgram/i.test(m.text())) errors.push(m.text()) })
    const goto = async query => {
      await page.goto(`${base}/?debug&lock=0&tier=${phone ? 'phone' : 'desktop'}&dpr=1&${query}`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('#splash', { state: 'detached' })
      await page.waitForFunction(() => window.__spinwardCar.group.userData.ready)
      await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
      await page.waitForTimeout(1400)
    }
    const shot = async label => page.screenshot({ path: `${out}civic-${phone ? 'phone' : 'desktop'}-${label}.png` })
    const visit = async label => {
      await page.getByRole('button', { name: phone ? 'Travel ▾' : 'Places ▾', exact: true }).click()
      await page.locator('.preset-menu:not([hidden])').getByRole('button', { name: label, exact: true }).last().click()
      await page.waitForTimeout(1500)
    }
    await goto('t=.42')
    await page.waitForTimeout(12000) // Let the real arrival look-up settle.
    await page.keyboard.press('Escape'); await page.keyboard.press('w')
    await page.waitForTimeout(100)
    await shot('arrival')
    const arrival = await page.evaluate(() => ({ a: window.__spinward.azimuth, ax: window.__spinward.axial,
      car: window.__spinward.drive, bay: window.__spinwardCity.getCarShareBay(), park: window.__spinwardCity.getPublicPark(),
      sprites: window.__spinwardTarget.group.children.filter(o => o.isSprite).length }))
    if (arrival.a * 3200 < 10 || arrival.ax < 10 || arrival.sprites) throw Error('Arrival remains in the road or target has a floating label')
    await visit('Ball practice'); await shot('practice')
    const target = await page.evaluate(() => ({ layout: window.__spinwardTarget.group.userData.layout,
      card: window.__spinwardTarget.getCard(window.__spinwardTarget.group.userData.layout.start, true), mode: window.__spinward.mode }))
    if (target.mode !== 'grounded' || target.card?.title !== 'BALL PRACTICE') throw Error('Practice visit is unusable')
    // Share-pose places the real walking body; a normal click throws the ball.
    const { azimuth, start } = target.layout
    const from = new T.Vector3(start.x, start.y, start.z), up = new T.Vector3(-Math.cos(azimuth), 0, -Math.sin(azimuth))
    const direction = up.clone().multiplyScalar(Math.sin(9 * Math.PI / 180)).add(new T.Vector3(0, -Math.cos(9 * Math.PI / 180), 0))
    const q = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(from, from.clone().add(direction), up))
    await goto(`t=.42&m=g&a=${azimuth}&ax=${start.y}&q=${q.toArray()}`)
    await page.mouse.click(phone ? 195 : 640, phone ? 230 : 340)
    await page.waitForTimeout(2000)
    const hit = await page.evaluate(() => window.__spinwardTarget.hasHit)
    await shot('throw-result')
    if (!hit) throw Error(`Real practice throw missed on ${phone ? 'phone' : 'desktop'}`)
    await visit('Car share'); await shot('car-parked')
    await page.getByRole('button', { name: 'Use car share', exact: true }).click()
    await page.waitForFunction(() => window.__spinward.drive.driving)
    await page.waitForTimeout(13000); await shot('driver')
    const before = await page.evaluate(() => ({ ...window.__spinward.drive }))
    await page.keyboard.down('w'); await page.waitForTimeout(1800); await page.keyboard.up('w')
    const driven = await page.evaluate(() => ({ ...window.__spinward.drive }))
    if (Math.hypot((driven.azimuth - before.azimuth) * 3200, driven.axial - before.axial) < 1) throw Error('Car did not drive')
    await page.keyboard.down('Space'); await page.waitForTimeout(1600); await page.keyboard.up('Space')
    await page.getByRole('button', { name: 'Leave car', exact: true }).click()
    await page.waitForFunction(() => !window.__spinward.drive.driving && window.__spinward.mode === 'grounded')
    await shot('dismount')
    await visit('Park')
    if (await page.evaluate(() => window.__spinward.drive.driving)) throw Error('Travel retained car attachment')
    reports.push({ phone, arrival, target, hit, before, driven })
    console.log(JSON.stringify({ phone, hit, distance: Math.hypot((driven.azimuth-before.azimuth)*3200, driven.axial-before.axial), errors }))
    await goto('t=.9&visit=car-share'); await page.waitForTimeout(9000); await shot('night-car')
    await page.close()
  }
} finally {
  fs.writeFileSync(out + 'civic-arrival.json', JSON.stringify({ errors, reports }, null, 2))
  await browser.close()
}
if (errors.length) throw Error(JSON.stringify(errors))
