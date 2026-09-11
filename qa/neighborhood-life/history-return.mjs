// Keep Chrome's normal back-forward cache enabled; Playwright disables it by
// default. Observe whether history restored this document or loaded a new one.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192', out = fileURLToPath(new URL('.', import.meta.url))
const prefix = process.env.PREFIX ?? 'history-return'
const browser = await chromium.launch({ channel: 'chrome', headless: true, ignoreDefaultArgs: ['--disable-back-forward-cache'] })
const errors = [], reports = []
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(noXr => {
    if (noXr) {
      // Absence must also make `xr in navigator` false, as on browsers without
      // WebXR. An undefined shadow property is not the same capability state.
      for (let object = navigator; object; object = Object.getPrototypeOf(object)) {
        if (Object.hasOwn(object, 'xr')) delete object.xr
      }
      if ('xr' in navigator) throw Error('Could not remove the test WebXR capability')
    }
    window.__historyProbe = { id: Date.now() + ':' + Math.random(), events: [] }
    for (const type of ['pageshow', 'pagehide', 'beforeunload']) addEventListener(type, event => window.__historyProbe.events.push({ type, persisted: event.persisted ?? null }))
  }, !!process.env.NO_XR)
  await page.goto(base + '/?debug&lock=0&t=.42&tier=phone')
  await page.waitForSelector('#splash', { state: 'detached' })
  await page.keyboard.press('1'); await page.waitForTimeout(1000)
  await page.keyboard.press('m'); await page.waitForTimeout(150)
  const snapshot = () => page.evaluate(() => ({ probe: window.__historyProbe, state: window.__spinward,
    dock: document.querySelectorAll('.dock').length, navigation: performance.getEntriesByType('navigation').map(n => ({ type: n.type, notRestoredReasons: n.notRestoredReasons?.toJSON?.() ?? null })) }))
  for (let cycle = 0; cycle < 3; cycle++) {
    const before = await snapshot()
    await page.keyboard.down('w')
    await page.goto('about:blank')
    // The cached game never receives this keyup; pagehide must clear intent.
    await page.keyboard.up('w')
    await page.goBack({ waitUntil: 'commit' })
    await page.waitForSelector('#splash', { state: 'detached' })
    await page.waitForTimeout(900)
    const after = await snapshot()
    await page.waitForTimeout(250)
    const resting = await snapshot()
    const restingDistance = Math.hypot((resting.state.azimuth - after.state.azimuth) * resting.state.radius, resting.state.axial - after.state.axial)
    await page.keyboard.down('w'); await page.waitForTimeout(600); await page.keyboard.up('w')
    const moved = await snapshot()
    const distance = Math.hypot((moved.state.azimuth - after.state.azimuth) * moved.state.radius, moved.state.axial - after.state.axial)
    const report = { cycle, sameDocument: before.probe.id === after.probe.id, before, after, moved, distance, restingDistance }
    reports.push(report); console.log(JSON.stringify({ cycle, sameDocument: report.sameDocument, dock: after.dock, events: after.probe.events, distance, errors }))
    if (process.env.EXPECT_RUNNING) {
      if (!after.dock || distance < .3) throw Error('History return did not resume an interactive colony')
      if (restingDistance > .08) throw Error('History return retained the old walking key')
      if (report.sameDocument && after.state.room.audio.muted !== before.state.room.audio.muted) throw Error('Cached return lost mute state')
      if (report.sameDocument && after.state.room.audio.state !== 'running') throw Error('Cached return did not resume the audio context')
      if (process.env.NO_XR && !report.sameDocument) throw Error('This run did not exercise cached restoration')
    }
  }
  if (errors.length) throw Error(JSON.stringify(errors))
} finally {
  fs.writeFileSync(out + prefix + '.json', JSON.stringify({ errors, reports }, null, 2)); await browser.close()
}
