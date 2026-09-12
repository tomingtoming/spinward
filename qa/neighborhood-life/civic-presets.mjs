import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const out = fileURLToPath(new URL('.', import.meta.url)), base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = [], reports = []
try {
  for (const phone of [false, true]) {
    const page = await browser.newPage({ ignoreHTTPSErrors: true, hasTouch: phone,
      viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 } })
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}/?debug&lock=0&t=.42&tier=${phone ? 'phone' : 'desktop'}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#splash', { state: 'detached' })
    await page.waitForFunction(() => window.__spinwardCar.group.userData.ready)
    await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
    for (const label of ['Cooper Station', 'Elysium', 'Playground Colony', 'Izma Colony']) {
      await page.getByRole('button', { name: 'Menu', exact: true }).click()
      await page.locator('.hud-chip--preset').focus(); await page.keyboard.press('Space')
      await page.locator('.preset-menu:not([hidden])').getByRole('button', { name: label, exact: true }).click()
      await page.waitForTimeout(1800)
      const snapshot = await page.evaluate(() => ({ radius: window.__spinward.radius, mode: window.__spinward.mode,
        bay: window.__spinwardCity.getCarShareBay(), drive: window.__spinward.drive,
        practice: window.__spinwardCity.getInteriorVisit('ball-practice'),
        car: window.__spinwardCity.getInteriorVisit('car-share'), layout: window.__spinwardTarget.group.userData.layout,
        targetVisible: window.__spinwardTarget.group.visible }))
      if (snapshot.mode !== 'grounded' || snapshot.drive.driving) throw Error('Preset retained an attachment')
      if (snapshot.radius < 800) {
        if (snapshot.bay || snapshot.practice || snapshot.car || !snapshot.targetVisible) throw Error('Small habitat retained city facilities')
      } else {
        if (!snapshot.practice || !snapshot.car || !snapshot.bay) throw Error('City lost its everyday destinations')
        if (Math.abs(snapshot.drive.azimuth - snapshot.bay.azimuth) > 1e-8 || Math.abs(snapshot.drive.axial - snapshot.bay.axial) > 1e-7) throw Error('Car retained the old colony parking pose')
        for (const place of ['Ball practice', 'Car share']) {
          await page.getByRole('button', { name: 'Places', exact: true }).click()
          await page.locator('.preset-menu:not([hidden])').getByRole('button', { name: `Go now to ${place}`, exact: true }).click()
          await page.waitForTimeout(900)
          if (await page.evaluate(() => window.__spinward.mode !== 'grounded')) throw Error('Place did not arrive grounded')
        }
      }
      reports.push({ phone, label, ...snapshot })
      console.log(JSON.stringify({ phone, label, radius: snapshot.radius, bay: snapshot.bay }))
    }
    // Confirm that unchanged practice text does not redraw its canvas per frame.
    const stable = await page.evaluate(() => {
      const target = window.__spinwardTarget, start = target.group.userData.layout.start
      return target.getCard(start, true) === target.getCard(start, true)
    })
    if (!stable) throw Error('Practice card repaints each frame')
    await page.close()
  }
} finally {
  fs.writeFileSync(out + 'civic-presets.json', JSON.stringify({ errors, reports }, null, 2))
  await browser.close()
}
if (errors.length) throw Error(JSON.stringify(errors))
