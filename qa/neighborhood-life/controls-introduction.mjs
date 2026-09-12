import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const out = fileURLToPath(new URL('.', import.meta.url)), base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192'
const browser = await chromium.launch({ channel: 'chrome', headless: true }), errors = [], reports = []
try {
 for (const phone of [false, true]) {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: phone })
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}/?debug&lock=0&t=.42&tier=${phone ? 'phone' : 'desktop'}&dpr=1`)
  await page.waitForSelector('#splash', { state: 'detached' })
  if (await page.locator('.controls-card').isVisible()) throw Error('Controls opened automatically')
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page.getByRole('button', { name: 'Controls', exact: true }).click()
  await page.waitForSelector('.controls-card:not([hidden])')
  await page.waitForTimeout(5500)
  if (!await page.locator('.controls-card').isVisible()) throw Error('Manual controls timed out while reading')
  await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
  await page.screenshot({ path: out + `ui-final-${phone ? 'phone' : 'desktop'}-controls.png` })
  await page.keyboard.press('Escape')
  await page.waitForSelector('.controls-card', { state: 'hidden' })
  await page.waitForTimeout(6000)
  if (await page.locator('.controls-card').isVisible()) throw Error('Automatic hint reappeared')
  reports.push({ phone, automaticAbsent: true, manualRetained: true, noRepeat: true })
  console.log(JSON.stringify(reports.at(-1)))
  await page.close()
 }
 const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } })
 page.on('pageerror', e => errors.push(e.message))
 await page.goto(`${base}/?debug&lock=0&visit=coffee&t=.42&dpr=1`)
 await page.waitForSelector('#splash', { state: 'detached' })
 await page.getByRole('button', { name: 'Brew coffee · self service', exact: true }).click()
 await page.waitForFunction(() => window.__spinward.room.coffee.phase === 'ready')
 await page.getByRole('button', { name: 'Take your coffee', exact: true }).click()
 await page.keyboard.down('s'); await page.waitForTimeout(1700); await page.keyboard.up('s')
 await page.waitForTimeout(15000)
 if (await page.locator('.controls-card').isVisible()) throw Error('Generic controls appeared after using the cafe')
 reports.push({ coffee: true, noDelayedHint: true })
 await page.close()
 fs.writeFileSync(out + 'controls-introduction.json', JSON.stringify({ errors, reports }, null, 2))
 console.log(JSON.stringify({ errors, reports }))
 if (errors.length) throw Error(JSON.stringify(errors))
} finally { await browser.close() }
