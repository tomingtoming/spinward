import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const out = fileURLToPath(new URL('.', import.meta.url)), base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192'
const prefix = process.env.PREFIX ?? 'jump-landing', strict = process.env.EXPECT_CONTACT === '1'
const browser = await chromium.launch({ channel: 'chrome', headless: true }), errors = [], reports = []
try {
 for (const preset of ['izma', 'cooper', 'elysium']) {
  const phone = preset === 'cooper', omega = preset === 'izma' ? 2 * Math.PI / 113.5 : preset === 'cooper' ? 2 * Math.PI / 120 : .01808
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: phone })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${base}/?debug&stats&preset=${preset}&tier=${phone ? 'phone' : 'desktop'}&m=g&a=0&ax=-200&t=.42&lock=0`)
  await page.waitForSelector('#splash', { state: 'detached' })
  await page.waitForFunction(() => window.__spinwardBody.group.userData.ready)
  await page.waitForTimeout(1500)
  await page.evaluate(omega => {
   document.querySelector('.lil-gui')?.remove(); document.activeElement?.blur()
   window.jumpSamples = []; let previous = window.__spinward.frameAngle, time = 0
   window.jumpTimer = setInterval(() => {
    const s = window.__spinward, b = window.__spinwardBody.group, delta = (s.frameAngle - previous + 2 * Math.PI) % (2 * Math.PI)
    time += delta / omega; previous = s.frameAngle
    window.jumpSamples.push({ time, wallTime: performance.now(), mode: s.mode, height: s.radius - s.radial, visible: b.visible, bodyMode: b.userData.mode, feet: b.userData.feet, steps: b.userData.steps })
   }, 10)
  }, omega)
  await page.keyboard.press('Space')
  await page.waitForTimeout(420)
  await page.screenshot({ path: out + `${prefix}-${preset}-arc.png` })
  await page.waitForTimeout(2500)
  const samples = await page.evaluate(() => { clearInterval(window.jumpTimer); return window.jumpSamples })
  const air = samples.filter(s => s.mode === 'free-fly'), landing = samples.find(s => s.time > air.at(-1)?.time && s.mode === 'grounded')
  const airTime = landing?.time - air[0]?.time, rise = Math.max(...air.map(s => s.height)) - samples.at(-1).height
  const report = { preset, airTime, rise, landed: !!landing, samples }
  reports.push(report)
  console.log(JSON.stringify({ preset, airTime, rise, landed: !!landing, samples: samples.length, errors }))
  if (strict && (!landing || airTime < .6 || airTime > 1.4 || rise < .55 || air.some(s => !s.visible || s.bodyMode !== 'airborne' || s.feet.some(f => f.planted)))) throw Error(`${preset}: incomplete jump arc`)
  await page.screenshot({ path: out + `${prefix}-${preset}-landed.png` })
  await page.close()
 }
 fs.writeFileSync(out + prefix + '.json', JSON.stringify({ errors, reports }, null, 2))
 if (errors.length) throw Error(JSON.stringify(errors))
} finally { await browser.close() }
