import fs from 'node:fs'
import * as T from 'three'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192', out = fileURLToPath(new URL('.', import.meta.url))
const prefix = process.env.PREFIX ?? 'public-park'
const browser = await chromium.launch({ channel: 'chrome', headless: true }), reports = [], errors = []
try {
 for (const config of [
  { preset: 'izma', phone: false, time: '.42' }, { preset: 'izma', phone: true, time: '.9' },
  { preset: 'cooper', phone: false, time: '.42' }, { preset: 'elysium', phone: false, time: '.42' }
 ].filter(c => (!process.env.PRESET || c.preset === process.env.PRESET) && (!process.env.TIER || (c.phone ? 'phone' : 'desktop') === process.env.TIER))) {
  const { preset, phone, time } = config, name = `${prefix}-${preset}-${phone ? 'phone-night' : 'desktop-day'}`
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: phone, deviceScaleFactor: 1 })
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error' && /mergeGeometries|shader|WebGL/i.test(m.text())) errors.push(m.text()) })
  const params = `debug&stats&preset=${preset}&t=${time}&tier=${phone ? 'phone' : 'desktop'}&dpr=1&lock=0`
  await page.goto(`${base}/?${params}`)
  await page.waitForSelector('#splash', { state: 'detached' })
  await page.getByRole('button', { name: phone ? 'Travel ▾' : 'Places ▾', exact: true }).click()
  await page.locator('.preset-menu:not([hidden])').getByRole('button', { name: 'Park', exact: true }).last().click()
  await page.waitForTimeout(1800)
  await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
  const arrival = await page.evaluate(() => ({ state: window.__spinward, park: window.__spinwardCity.getPublicPark(), visit: window.__spinwardCity.getInteriorVisit('park') }))
  const { park, state, visit } = arrival, r = state.radius
  if (state.mode !== 'grounded' || state.room.seat || state.room.sensor || state.tour !== 'visit-park') throw Error('Invalid park arrival')
  let distance = null, walked = null
  const seating = []
  if (!process.env.OVERVIEW_ONLY) {
  await page.screenshot({ path: out + name + '-entrance.png' })
  await page.keyboard.down('w'); await page.waitForTimeout(4200); await page.keyboard.up('w')
  walked = await page.evaluate(() => ({ a: window.__spinward.azimuth, ax: window.__spinward.axial, mode: window.__spinward.mode, height: window.__spinward.groundHeight }))
  distance = Math.hypot(Math.atan2(Math.sin(walked.a - visit.azimuth), Math.cos(walked.a - visit.azimuth)) * r, walked.ax - visit.axial)
  if (distance < 5 || walked.mode !== 'grounded' || walked.height > .2) throw Error('Park entrance obstructed: ' + JSON.stringify(walked))
  await page.screenshot({ path: out + name + '-walk.png' })
  const seats = state.room.seats.filter(s => s.id.startsWith('park-bench'))
  if (seats.length !== 2) throw Error('Missing park seats')
  for (const seat of seats) {
   const a = seat.azimuth, ax = seat.exit.axialPosition + .3
   const p = new T.Vector3(Math.cos(a) * (r - 1.6), ax, Math.sin(a) * (r - 1.6))
   const target = new T.Vector3(Math.cos(a) * (r - .8), seat.axialPosition - .18, Math.sin(a) * (r - .8))
   const q = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(p, target, new T.Vector3(-Math.cos(a), 0, -Math.sin(a))))
   await page.goto(`${base}/?${params}&m=g&a=${a}&ax=${ax}&q=${q.toArray()}`)
   await page.waitForSelector('#splash', { state: 'detached' })
   await page.waitForFunction(() => window.__spinwardBody.group.userData.ready)
   // A fresh page may have loaded the body before the local lights have
   // faded up or the first material programs have finished compiling.
   await page.waitForTimeout(1000)
   await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
   await page.screenshot({ path: out + name + '-' + seat.id + '-approach.png' })
   if (phone) await page.getByRole('button', { name: 'Sit · Park bench', exact: true }).tap()
   else await page.keyboard.press('e')
   await page.waitForFunction(id => window.__spinward.room.seat === id, seat.id)
   await page.keyboard.down('ArrowDown'); await page.waitForTimeout(650); await page.keyboard.up('ArrowDown')
   const seated = await page.evaluate(() => {
    const c = window.__spinwardScene.getObjectByName('coffee-held').parent, p = c.getWorldPosition(c.position.clone())
    return { body: window.__spinwardBody.group.userData, eyeHeight: window.__spinward.radius - Math.hypot(p.x, p.z), sensor: window.__spinward.room.sensor }
   })
   if (seated.body.mode !== 'seated' || !seated.sensor || Math.abs(seated.eyeHeight - seat.seatHeight - .7) > .03) throw Error('Incorrect seated body')
   await page.screenshot({ path: out + name + '-' + seat.id + '-seated.png' })
   if (phone) await page.getByRole('button', { name: 'Stand up', exact: true }).tap()
   else await page.keyboard.press('e')
   await page.waitForFunction(() => !window.__spinward.room.seat && !window.__spinward.room.sensor)
   await page.waitForTimeout(600)
   const stood = await page.evaluate(() => ({ a: window.__spinward.azimuth, ax: window.__spinward.axial, mode: window.__spinward.mode, floor: window.__spinwardBody.surfaces.sample(window.__spinward.azimuth, window.__spinward.axial, 0, false) }))
   if (stood.mode !== 'grounded' || Math.abs(stood.ax - seat.exit.axialPosition) > .1 || Math.abs(stood.floor - .14) > .001) throw Error('Unclear park seat exit')
   seating.push({ id: seat.id, seated, stood })
  }
  }
  // The street-corner view keeps the garden and its surrounding city together.
  const a = park.azimuth + 25 / r, ax = park.axial - 25
  const p = new T.Vector3(Math.cos(a) * (r - 1.8), ax, Math.sin(a) * (r - 1.8))
  const target = new T.Vector3(Math.cos(park.azimuth) * (r - 2), park.axial, Math.sin(park.azimuth) * (r - 2))
  const q = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(p, target, new T.Vector3(-Math.cos(a), 0, -Math.sin(a))))
  await page.goto(`${base}/?${params}&m=g&a=${a}&ax=${ax}&q=${q.toArray()}`)
  await page.waitForSelector('#splash', { state: 'detached' }); await page.waitForTimeout(1200)
  await page.evaluate(() => { document.querySelector('.lil-gui')?.remove(); window.__spinwardCity.civicDetails.group.visible = false })
  await page.screenshot({ path: out + name + '-overview-before.png' })
  await page.evaluate(() => { window.__spinwardCity.civicDetails.group.visible = true })
  await page.screenshot({ path: out + name + '-overview-after.png' })
  const report = { name, park, distance, walked, seating, errors }; reports.push(report); console.log(JSON.stringify(report))
  await page.close()
 }
 fs.writeFileSync(out + prefix + (process.env.OVERVIEW_ONLY ? '-overview.json' : '.json'), JSON.stringify({ errors, reports }, null, 2))
 if (errors.length) throw Error(JSON.stringify(errors))
} finally { await browser.close() }
