import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192', prefix = process.env.PREFIX ?? 'audio-activity'
const out = fileURLToPath(new URL('.', import.meta.url)), browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = [], reports = []
try {
 for (const phone of [false, true]) {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: phone })
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(() => {
   const Native = window.AudioContext
   window.audioContexts = []
   window.AudioContext = class extends Native { constructor(...args) { super(...args); window.audioContexts.push(this) } }
  })
  await page.goto(`${base}/?debug&lock=0&t=.42&tier=${phone ? 'phone' : 'desktop'}`)
  await page.waitForSelector('#splash', { state: 'detached' })
  const initial = await page.evaluate(() => ({ count: window.audioContexts.length, state: window.audioContexts[0]?.state, time: window.audioContexts[0]?.currentTime, publicState: window.__spinward.room.audio.state }))
  await page.waitForTimeout(300)
  const idleClockAdvance = await page.evaluate(time => window.audioContexts[0]?.currentTime - time, initial.time)
  await page.keyboard.press('m'); await page.keyboard.press('m')
  await page.waitForTimeout(200)
  const state = () => page.evaluate(() => ({ count: window.audioContexts.length, state: window.audioContexts[0]?.state, time: window.audioContexts[0]?.currentTime, muted: window.__spinward.room.audio.muted }))
  const visible = await state()
  // Inject the visibility event while retaining JS observability in headless
  // Chrome. This tests app handling against a real WebAudio context, not OS
  // background throttling or mobile device suspension.
  const visibility = async hidden => page.evaluate(hidden => {
   Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
   Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' })
   document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)
  await visibility(true); await page.waitForTimeout(250)
  const hidden = await state(); await page.waitForTimeout(300); const hiddenLater = await state()
  await visibility(false); await page.waitForTimeout(250); const resumed = await state()
  if (process.env.EXPECT_PAUSED) {
   if (initial.count !== 1 || initial.state !== 'suspended' || initial.publicState !== 'locked' || idleClockAdvance > .03 || visible.state !== 'running' || hidden.state !== 'suspended' || hiddenLater.time - hidden.time > .03 || resumed.state !== 'running' || resumed.count !== 1) throw Error('Audio activity failed')
   if (phone) await page.locator('.dock-more').tap()
   await page.getByRole('button', { name: 'Sound on', exact: true }).click()
   await page.waitForFunction(() => window.__spinward.room.audio.muted)
   await page.screenshot({ path: out + prefix + '-' + (phone ? 'phone' : 'desktop') + '-muted.png' })
   await visibility(true); await visibility(false); await visibility(true)
   await page.waitForTimeout(300)
   if ((await state()).state !== 'suspended') throw Error('Rapid hide/show left sound active')
   await visibility(false); await page.waitForTimeout(250)
   if (!(await state()).muted) throw Error('Visibility reset the mute preference')
   await page.getByRole('button', { name: 'Sound off', exact: true }).click()
   await page.waitForFunction(() => !window.__spinward.room.audio.muted)
   await page.evaluate(() => document.activeElement?.blur())
   await page.keyboard.press('m'); await page.waitForTimeout(150)
   if (await page.getByRole('button', { name: 'Sound off', exact: true }).count() !== 1) throw Error('Keyboard and sound button disagree')
  }
  const report = { phone, initial, idleClockAdvance, visible, hidden, hiddenLater, resumed, hiddenClockAdvance: hiddenLater.time - hidden.time, errors }
  reports.push(report); console.log(JSON.stringify(report)); await page.close()
 }
 fs.writeFileSync(out + prefix + '.json', JSON.stringify({ errors, reports }, null, 2))
 if (errors.length) throw Error(JSON.stringify(errors))
} finally { await browser.close() }
