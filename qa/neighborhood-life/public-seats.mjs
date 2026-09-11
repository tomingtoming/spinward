import fs from 'node:fs'
import * as T from 'three'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192', out = fileURLToPath(new URL('.', import.meta.url))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = [], samples = []
try {
  const configs = [
    { preset: 'izma', time: '.42', phone: false },
    { preset: 'izma', time: '.9', phone: true },
    { preset: 'cooper', time: '.42', phone: false },
    { preset: 'elysium', time: '.42', phone: false }
  ].filter(c => !process.env.PRESET || c.preset === process.env.PRESET)
  for (const config of configs) {
    const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: config.phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: config.phone, deviceScaleFactor: 1 })
    page.on('pageerror', e => errors.push(e.message))
    const params = `debug&stats&preset=${config.preset}&t=${config.time}&tier=${config.phone ? 'phone' : 'desktop'}&dpr=1`
    await page.goto(`${base}/?${params}`)
    await page.waitForFunction(() => window.__spinward?.room.seats.some(s => s.id.startsWith('plaza-bench')))
    const seats = await page.evaluate(() => window.__spinward.room.seats.filter(s => s.id.startsWith('plaza-bench')))
    for (const seat of seats) {
      const a = seat.azimuth, ax = seat.exit.axialPosition + .4, r = seat.radius
      const position = new T.Vector3(Math.cos(a) * (r - 1.6), ax, Math.sin(a) * (r - 1.6))
      const target = new T.Vector3(Math.cos(a) * (r - .65), seat.axialPosition - .18, Math.sin(a) * (r - .65))
      const q = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(position, target, new T.Vector3(-Math.cos(a), 0, -Math.sin(a))))
      await page.goto(`${base}/?${params}&m=g&a=${a}&ax=${ax}&q=${q.toArray()}`)
      await page.waitForSelector('#splash', { state: 'detached' })
      await page.waitForFunction(() => window.__spinwardBody.group.userData.ready)
      await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
      const name = `public-seat-${config.preset}-${config.phone ? 'phone-night' : 'desktop-day'}-${seat.id}`
      await page.screenshot({ path: out + name + '-approach.png' })
      if (config.phone) await page.getByRole('button', { name: 'Sit · Plaza bench', exact: true }).tap()
      else await page.keyboard.press('e')
      await page.waitForFunction(id => window.__spinward.room.seat === id, seat.id)
      await page.keyboard.down('ArrowDown'); await page.waitForTimeout(850); await page.keyboard.up('ArrowDown')
      const seated = await page.evaluate(() => {
        const c = window.__spinwardScene.getObjectByName('coffee-held').parent, p = c.getWorldPosition(c.position.clone())
        return { body: window.__spinwardBody.group.userData, visible: window.__spinwardBody.group.visible,
          eyeHeight: window.__spinward.radius - Math.hypot(p.x, p.z), seat: window.__spinward.room.seat,
          sensor: window.__spinward.room.sensor, room: window.__spinward.room.shelter }
      })
      if (seated.body.mode !== 'seated' || !seated.visible || !seated.sensor || Math.abs(seated.eyeHeight - (seat.seatHeight + .7)) > .03) throw Error('Invalid public seating: ' + JSON.stringify(seated))
      await page.screenshot({ path: out + name + '-seated.png' })
      if (config.phone) await page.getByRole('button', { name: 'Stand up', exact: true }).tap()
      else await page.keyboard.press('e')
      await page.waitForFunction(() => !window.__spinward.room.seat)
      await page.waitForTimeout(500)
      const standing = await page.evaluate(() => ({ axial: window.__spinward.axial, azimuth: window.__spinward.azimuth, sensor: window.__spinward.room.sensor, body: window.__spinwardBody.group.userData }))
      if (standing.sensor || standing.body.mode !== 'standing' || Math.abs(standing.axial - seat.exit.axialPosition) > .06) throw Error('Unclear seat exit: ' + JSON.stringify(standing))
      await page.screenshot({ path: out + name + '-stood.png' })
      // The view now faces the clear aisle. Back toward the bench using normal
      // walking input: its physical proxy must stop the body before the back.
      await page.keyboard.down('s'); await page.waitForTimeout(1600); await page.keyboard.up('s')
      const blocked = await page.evaluate(() => ({ axial: window.__spinward.axial, height: window.__spinward.groundHeight, mode: window.__spinward.mode }))
      if (blocked.axial < seat.axialPosition - .18 || blocked.mode !== 'grounded' || blocked.height > .05) throw Error('Walked through or floated beside the public bench: ' + JSON.stringify(blocked))
      samples.push({ name, seat, seated, standing, blocked })
      console.log(JSON.stringify({ name, eyeHeight: seated.eyeHeight, pelvis: seated.body.pelvis, sensorAfterExit: standing.sensor, blocked }))
    }
    await page.close()
  }
  fs.writeFileSync(out + 'public-seats.json', JSON.stringify({ errors, samples }, null, 2))
  if (errors.length) throw Error(JSON.stringify(errors))
} finally { await browser.close() }
