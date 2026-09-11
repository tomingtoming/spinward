import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192', out = fileURLToPath(new URL('.', import.meta.url))
const browser = await chromium.launch({ channel: 'chrome', headless: true }), errors = [], reports = []
try {
 for (const tier of ['desktop', 'phone']) {
  const phone = tier === 'phone', page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: phone })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', m => { if (m.type() === 'error' && /shader|WebGLProgram/i.test(m.text())) errors.push(m.text()) })
  await page.goto(`${base}/?debug&stats&m=g&a=0&ax=-200&t=.9&tier=${tier}&dpr=1&lock=0`)
  await page.waitForSelector('#splash', { state: 'detached' })
  await page.waitForFunction(() => window.__spinwardStreetLamps.lighting.slots.some(s => s.light.intensity > 0))
  await page.evaluate(() => {
   document.querySelector('.lil-gui')?.remove(); document.activeElement?.blur()
   window.lampWalk = { started: { ...window.__spinward }, frames: 0, switches: 0, movedSources: 0, brightSwitches: 0, activePeak: 0, done: false }
   let previous = []
   const frame = () => {
    const report = window.lampWalk
    if (report.done) return
    const slots = window.__spinwardStreetLamps.lighting.slots
    report.frames++; report.activePeak = Math.max(report.activePeak, slots.filter(s => s.light.intensity > .01).length)
    slots.forEach((s, i) => {
     const p = previous[i], id = s.source?.id ?? null
     if (p && id === p.id && s.light.position.distanceTo(p.position) > .00001) report.movedSources++
     if (p && id !== p.id && id) { report.switches++; if (s.light.intensity > .00001) report.brightSwitches++ }
    })
    previous = slots.map(s => ({ id: s.source?.id ?? null, position: s.light.position.clone() }))
    requestAnimationFrame(frame)
   }
   requestAnimationFrame(frame)
  })
  await page.keyboard.down('Shift'); await page.keyboard.down('w')
  await page.waitForTimeout(35000)
  await page.keyboard.up('w'); await page.keyboard.up('Shift')
  const report = await page.evaluate(() => {
   window.lampWalk.done = true
   const s = window.__spinward, old = window.lampWalk.started
   return { ...window.lampWalk, started: { axial: old.axial, azimuth: old.azimuth }, travel: Math.hypot((s.azimuth - old.azimuth) * s.radius, s.axial - old.axial), final: { axial: s.axial, azimuth: s.azimuth, mode: s.mode } }
  })
  if (report.travel < 100 || !report.switches || report.movedSources || report.brightSwitches || report.activePeak > (phone ? 1 : 2)) throw Error(JSON.stringify(report))
  reports.push({ tier, ...report }); console.log(JSON.stringify({ tier, ...report, errors }))
  await page.screenshot({ path: out + `street-light-${tier}-walk.png` })
  if (phone) await page.getByRole('button', { name: 'Travel ▾', exact: true }).click()
  await page.getByRole('button', { name: 'Axis', exact: true }).click()
  await page.waitForTimeout(500)
  const axis = await page.evaluate(() => window.__spinwardStreetLamps.lighting.slots.map(s => s.light.intensity))
  if (axis.some(i => i > .01)) throw Error('Distant travel retained street light')
  await page.close()
 }
 fs.writeFileSync(out + 'street-light-walk.json', JSON.stringify({ errors, reports }, null, 2))
 if (errors.length) throw Error(JSON.stringify(errors))
} finally { await browser.close() }
