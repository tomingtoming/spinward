import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192', out = fileURLToPath(new URL('.', import.meta.url))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = [], reports = []
const places = [
  { id: 'visit-cafe', label: 'Café', kind: 'cafe' },
  { id: 'visit-courtyard', label: 'Courtyard', kind: 'court' },
  { id: 'visit-apartment', label: 'Apartment', kind: 'nyaan' },
  { id: 'visit-shops', label: 'Market street', kind: 'shops' }
]
try {
  for (const phone of [false, true]) {
    const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: phone })
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}/?debug&lock=0&t=${phone ? '.9' : '.42'}&tier=${phone ? 'phone' : 'desktop'}`)
    await page.waitForSelector('#splash', { state: 'detached' })
    await page.waitForFunction(() => window.__spinwardBody?.group.userData.ready)
    await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
    for (const [preset, label] of [['izma', 'Izma Colony'], ['cooper', 'Cooper Station'], ['elysium', 'Elysium'], ['playground', 'Playground Colony'], ['izma', 'Izma Colony']]) {
      if ((await page.locator('.hud-chip--preset').textContent()).trim() !== label) {
        // Native keyboard activation of the same preset menu also exercises
        // availability after an in-page rebuild, not just fresh page loads.
        if (phone) await page.locator('.dock-more').click()
        await page.locator('.hud-chip--preset').focus(); await page.keyboard.press('Space')
        await page.locator('.preset-menu:not([hidden])').getByRole('button', { name: label, exact: true }).click()
        if (phone) await page.locator('.dock-more').click()
        await page.waitForTimeout(1400)
      }
      const destinations = await page.evaluate(places => places.map(place => ({ ...place,
        anchor: window.__spinwardCity.getInteriorVisit(place.kind)
      })), places)
      const available = destinations.filter(place => place.anchor)
      const chip = page.getByRole('button', { name: phone ? 'Travel ▾' : 'Places ▾', exact: true })
      if (!phone && await chip.isVisible() !== (available.length > 0)) throw Error('Stale Places availability at ' + preset)
      if (phone || available.length) {
        await chip.click()
        const menu = page.locator('.preset-menu:not([hidden])')
        for (const place of destinations) {
          if (await menu.getByRole('button', { name: place.label, exact: true }).isVisible() !== !!place.anchor) throw Error('Invalid visible destination: ' + preset + '/' + place.id)
        }
        await page.keyboard.press('Escape')
      }
      const results = []
      for (const place of available) {
        await chip.click()
        await page.locator('.preset-menu:not([hidden])').getByRole('button', { name: place.label, exact: true }).click()
        await page.waitForTimeout(1800)
        const state = await page.evaluate(() => ({ ...window.__spinward, body: window.__spinwardBody.group.userData }))
        const offset = Math.hypot(Math.atan2(Math.sin(state.azimuth-place.anchor.azimuth), Math.cos(state.azimuth-place.anchor.azimuth))*state.radius, state.axial-place.anchor.axial)
        if (state.mode !== 'grounded' || state.drive.driving || state.room.seat || state.room.sensor || offset > .25 || state.groundHeight > .1 || state.tour !== place.id) throw Error('Invalid place arrival: ' + JSON.stringify({ preset, place: place.id, offset, state }))
        const coffee = place.id === 'visit-cafe' && await page.getByRole('button', { name: /Brew coffee/ }).isVisible()
        const name = `place-${preset}-${phone ? 'phone-night' : 'desktop-day'}-${place.kind}`
        await page.screenshot({ path: out + name + '.png' })
        let entered = null
        if (place.kind !== 'shops') {
          await page.keyboard.down('w'); await page.waitForTimeout(2000); await page.keyboard.up('w')
          const walked = await page.evaluate(() => ({ ...window.__spinward }))
          const distance = Math.hypot(Math.atan2(Math.sin(walked.azimuth-state.azimuth), Math.cos(walked.azimuth-state.azimuth))*state.radius, walked.axial-state.axial)
          entered = { distance, shelter: walked.room.shelter, height: walked.groundHeight, mode: walked.mode }
          if (distance < 1.5 || walked.groundHeight > .1 || walked.mode !== 'grounded') throw Error('Entrance does not admit the walking body: ' + JSON.stringify({ preset, id: place.id, entered }))
        }
        results.push({ id: place.id, offset, coffee, bodyMode: state.body.mode, shelter: state.room.shelter, entered })
      }
      reports.push({ preset, phone, available: available.map(p => p.id), results })
      console.log(JSON.stringify(reports.at(-1)))
    }
    // Travel out of an occupied vehicle must retain the destination after
    // normal frames run, instead of the driving update restoring the car pose.
    const travel = async label => {
      if (phone) await page.getByRole('button', { name: 'Travel ▾', exact: true }).click()
      await page.getByRole('button', { name: label, exact: true }).click()
    }
    await travel('Surface'); await page.waitForTimeout(500)
    await page.keyboard.press('e'); await page.waitForFunction(() => window.__spinward.drive.driving)
    await page.keyboard.down('w'); await page.waitForTimeout(250)
    await travel('Exterior'); await page.keyboard.up('w'); await page.waitForTimeout(2000)
    const exterior = await page.evaluate(() => ({ driving: window.__spinward.drive.driving, mode: window.__spinward.mode, radial: window.__spinward.radial, radius: window.__spinward.radius }))
    if (exterior.driving || exterior.mode !== 'free-fly' || exterior.radial < exterior.radius * 1.1) throw Error('Travel remained attached to the rover: ' + JSON.stringify(exterior))
    await travel('Surface'); await page.waitForTimeout(1000)
    const surface = await page.evaluate(() => ({ driving: window.__spinward.drive.driving, mode: window.__spinward.mode, sensor: window.__spinward.room.sensor }))
    if (surface.driving || surface.mode !== 'grounded' || surface.sensor) throw Error('Return from Exterior retained an attachment')
    reports.push({ phone, exterior, surface })
    const seat = await page.evaluate(() => window.__spinward.room.seats.find(s => s.id.startsWith('plaza-bench')))
    await page.goto(`${base}/?debug&lock=0&t=.42&tier=${phone ? 'phone' : 'desktop'}&m=g&a=${seat.exit.azimuth}&ax=${seat.exit.axialPosition}`)
    await page.waitForSelector('#splash', { state: 'detached' })
    await page.keyboard.press('e'); await page.waitForFunction(() => !!window.__spinward.room.seat)
    await page.getByRole('button', { name: phone ? 'Travel ▾' : 'Places ▾', exact: true }).click()
    await page.locator('.preset-menu:not([hidden])').getByRole('button', { name: 'Café', exact: true }).click()
    await page.waitForTimeout(1400)
    const unseated = await page.evaluate(() => ({ seat: window.__spinward.room.seat, sensor: window.__spinward.room.sensor, tour: window.__spinward.tour, mode: window.__spinward.mode }))
    if (unseated.seat || unseated.sensor || unseated.mode !== 'grounded' || unseated.tour !== 'visit-cafe') throw Error('Travel retained the bench attachment')
    reports.push({ phone, unseated })
    await page.close()
  }
  fs.writeFileSync(out + 'place-travel.json', JSON.stringify({ errors, reports }, null, 2))
  if (errors.length) throw Error(JSON.stringify(errors))
} finally { await browser.close() }
