import { fileURLToPath } from 'node:url'
import * as T from 'three'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const out = fileURLToPath(new URL('.', import.meta.url)), base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  const goto = async query => {
    await page.goto(`${base}/?debug&lock=0&t=.42&tier=desktop&dpr=1&${query}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#splash', { state: 'detached' })
    await page.waitForFunction(() => window.__spinwardCar.group.userData.ready)
    await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
  }
  await goto('')
  const { park, bay } = await page.evaluate(() => ({ park: window.__spinwardCity.getPublicPark(), bay: window.__spinwardCity.getCarShareBay() }))
  for (const [name, x, y, tx, ty] of [
    ['square', 13.25, 9.2, 14.75, 13.25],
    ['practice', park.azimuth * 3200 - 2.35, park.axial + 8, park.azimuth * 3200 - 2.35, park.axial + 4.3],
    ['share', bay.azimuth * 3200 - 1, bay.axial - 5.7, bay.azimuth * 3200 + 2.5, bay.axial - 2.6]
  ]) {
    const a = x / 3200, ta = tx / 3200
    const p = new T.Vector3(Math.cos(a) * (3200 - 1.8), y, Math.sin(a) * (3200 - 1.8))
    const target = new T.Vector3(Math.cos(ta) * (3200 - 1.5), ty, Math.sin(ta) * (3200 - 1.5))
    const q = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(p, target, new T.Vector3(-Math.cos(a), 0, -Math.sin(a))))
    await goto(`m=g&a=${a}&ax=${y}&q=${q.toArray()}`)
    await page.keyboard.press('w'); await page.waitForTimeout(10000)
    await page.screenshot({ path: out + `civic-sign-${name}.png` })
    console.log(JSON.stringify({ name, errors }))
  }
  if (errors.length) throw Error(JSON.stringify(errors))
} finally { await browser.close() }
