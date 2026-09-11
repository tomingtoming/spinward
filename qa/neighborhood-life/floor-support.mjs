import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const out = fileURLToPath(new URL('.', import.meta.url)), base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192'
const disable = process.env.DISABLE_SUPPORT === '1', prefix = process.env.PREFIX ?? (disable ? 'floor-without-support' : 'floor-with-support')
const browser = await chromium.launch({ channel: 'chrome', headless: true }), reports = [], errors = []
try {
 for (const [preset, azimuth, axial] of [['cooper', .12, 0], ['cooper', -.12, 0], ['izma', 0, -200], ['elysium', 0, -200]]) {
  const phone = preset === 'cooper', page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: phone })
  page.on('pageerror', error => errors.push(error.message))
  if (disable) await page.addInitScript(() => {
   let drive
   // Disable before the first physics step: turning support off after the
   // sphere has settled would retain the established rounded contact cache.
   Object.defineProperty(window, '__spinwardDrive', { configurable: true,
    get: () => drive, set: value => {
     drive = value
     value.world.colliders.forEach(c => { if (c.collisionGroups() === 0x00010002) c.setEnabled(false) })
    }
   })
  })
  await page.goto(`${base}/?debug&stats&preset=${preset}&tier=${phone ? 'phone' : 'desktop'}&m=g&a=${azimuth}&ax=${axial}&t=.42&lock=0`)
  await page.waitForSelector('#splash', { state: 'detached' })
  await page.waitForFunction(() => window.__spinwardBody.group.userData.ready)
  const report = await page.evaluate(async disable => {
   document.querySelector('.lil-gui')?.remove()
   const world = window.__spinwardDrive.world, step = world.step.bind(world), samples = [], physicsMs = [], frameMs = []
   let supportCount = 0, last = 0, active = true
   world.colliders.forEach(c => { if (c.collisionGroups() === 0x00010002) { supportCount++; c.setEnabled(!disable) } })
   world.step = (...args) => { const t = performance.now(); const result = step(...args); physicsMs.push(performance.now() - t); return result }
   const frame = t => {
    if (!active) return
    if (last) frameMs.push(t - last); last = t
    const s = window.__spinward
    samples.push({ time: t, gap: s.radius - s.radial - s.groundHeight, mode: s.mode, azimuth: s.azimuth, axial: s.axial })
    requestAnimationFrame(frame)
   }
   requestAnimationFrame(frame)
   await new Promise(resolve => setTimeout(resolve, 9000))
   active = false; world.step = step
   const quantiles = a => { a = a.slice(60).sort((a, b) => a - b); return { median: a[Math.floor(a.length * .5)], p95: a[Math.floor(a.length * .95)], max: a.at(-1) } }
   const steady = samples.slice(60)
   return { supportCount, minGap: Math.min(...steady.map(s => s.gap)), maxGap: Math.max(...steady.map(s => s.gap)), finalMode: samples.at(-1).mode, physicsMs: quantiles(physicsMs), frameMs: quantiles(frameMs), samples }
  }, disable)
  reports.push({ preset, azimuth, axial, ...report })
  console.log(JSON.stringify({ preset, azimuth, axial, ...report, samples: report.samples.length, errors }))
  await page.screenshot({ path: out + `${prefix}-${preset}-${azimuth}.png` })
  if (!report.supportCount || (!disable && (report.minGap < .04 || report.maxGap > .9 || report.finalMode !== 'grounded'))) throw Error('Unstable physical floor')
  await page.close()
 }
 fs.writeFileSync(out + prefix + '.json', JSON.stringify({ errors, reports }, null, 2))
 if (errors.length) throw Error(JSON.stringify(errors))
} finally { await browser.close() }
