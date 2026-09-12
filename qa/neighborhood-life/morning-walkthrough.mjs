// Actual browser input footage. WebM sources live in a task-specific /tmp folder;
// JSON includes the loading trim and chapter timings for a silent review export.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as T from 'three'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const out = fileURLToPath(new URL('.', import.meta.url))
const base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192'
const prefix = process.env.PREFIX ?? 'morning-walkthrough'
const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'spinward-walkthrough-'))
const viewport = { width: 1280, height: 800 }, errors = [], clips = []
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const pose = (a, ax, height, aimHeight, aimAx, r = 3200) => {
  const p = new T.Vector3(Math.cos(a)*(r-height), ax, Math.sin(a)*(r-height))
  const target = new T.Vector3(Math.cos(a)*(r-aimHeight), aimAx, Math.sin(a)*(r-aimHeight))
  const q = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(p, target, new T.Vector3(-Math.cos(a), 0, -Math.sin(a))))
  return `m=g&a=${a}&ax=${ax}&q=${q.toArray()}`
}
async function run(name, query, prepare, perform) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 1, recordVideo: { dir: raw, size: viewport } })
  const page = await context.newPage(), created = Date.now(), video = page.video()
  page.on('pageerror', e => errors.push({ name, message: e.message }))
  page.on('console', m => { if (m.type() === 'error' && /shader|WebGLProgram/i.test(m.text())) errors.push({ name, message: m.text() }) })
  const goto = async q => {
    await page.goto(`${base}/?debug&lock=0&tier=desktop&dpr=1&${q}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('#splash', { state: 'detached' })
    await page.waitForFunction(() => window.__spinwardBody.group.userData.ready)
    await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
  }
  const key = async (key, ms) => { await page.keyboard.down(key); try { await page.waitForTimeout(ms) } finally { await page.keyboard.up(key) } }
  const wait = ms => page.waitForTimeout(ms)
  const snapshot = async label => {
    const data = await page.evaluate(() => ({ state: window.__spinward, body: { visible: window.__spinwardBody.group.visible, ...window.__spinwardBody.group.userData } }))
    await page.screenshot({ path: `${out}${prefix}-${name}-${label}.png` })
    return data
  }
  try {
    await goto(query)
    const preparation = await prepare?.({ page, goto, key, wait })
    await wait(16000) // Let the destination card and following controls peek expire.
    await page.keyboard.press('Escape') // Dismiss the initial controls peek via its real UI.
    await wait(250)
    const start = (Date.now() - created) / 1000, before = await snapshot('before')
    await perform({ page, goto, key, wait })
    const after = await snapshot('after'), duration = (Date.now() - created) / 1000 - start
    await context.close()
    const record = { name, file: await video.path(), start, duration, preparation, before, after }
    clips.push(record); console.log(JSON.stringify({ name, start, duration, mode: after.state.mode, errors }))
    fs.writeFileSync(`${out}${prefix}.json`, JSON.stringify({ base, raw, viewport, errors, clips }, null, 2))
  } catch (error) { await context.close(); throw error }
}
try {
  await run('body-and-street', `t=.42&${pose(0, -200, 1.8, .22, -199.35)}`, async ({ page, wait }) => {
    const duration = Number(process.env.IDLE_MS ?? 0)
    if (!duration) return null
    const before = await page.evaluate(() => ({ a: window.__spinward.azimuth, ax: window.__spinward.axial }))
    await wait(duration)
    const after = await page.evaluate(() => ({ a: window.__spinward.azimuth, ax: window.__spinward.axial, mode: window.__spinward.mode, body: window.__spinwardBody.group.userData }))
    const drift = Math.hypot(Math.atan2(Math.sin(after.a - before.a), Math.cos(after.a - before.a)) * 3200, after.ax - before.ax)
    if (after.mode !== 'grounded' || drift > .12) throw Error('Idle player drifts: ' + JSON.stringify({ duration, drift, before, after }))
    console.log(JSON.stringify({ idleMs: duration, drift }))
    return { duration, drift, before, after }
  }, async ({ page, key, wait }) => {
    await wait(1200); await key('w', 2800); await wait(1100)
    await key('ArrowUp', 800); await key('w', 4500); await wait(1600)
    await page.keyboard.press('Space')
    await page.waitForFunction(() => window.__spinward.mode === 'free-fly', null, { timeout: 3000 })
    await page.waitForFunction(() => window.__spinward.mode === 'grounded', null, { timeout: 6000 })
    await wait(1000)
  })
  await run('park-seat', 't=.42', async ({ page, goto }) => {
    await page.getByRole('button', { name: 'Places ▾', exact: true }).click()
    await page.locator('.preset-menu:not([hidden])').getByRole('button', { name: 'Park', exact: true }).last().click()
    const seat = await page.evaluate(() => window.__spinward.room.seats.find(s => s.id.startsWith('park-bench')))
    if (!seat) throw Error('Missing real park seat')
    await goto(`t=.42&${pose(seat.azimuth, seat.exit.axialPosition + .3, 1.8, .8, seat.axialPosition - .18)}`)
  }, async ({ page, key, wait }) => {
    await wait(1100); await page.keyboard.press('e')
    await page.waitForFunction(() => window.__spinward.room.seat?.startsWith('park-bench'))
    await key('ArrowDown', 650); await wait(2200); await key('ArrowUp', 650); await wait(2000)
    await page.keyboard.press('e'); await key('w', 2000); await key('ArrowLeft', 500); await wait(1400)
  })
  await run('cafe', 't=.42&visit=coffee', null, async ({ page, key, wait }) => {
    await wait(700); await page.keyboard.press('c')
    await page.waitForFunction(() => window.__spinward.room.coffee.phase === 'ready')
    await page.keyboard.press('c'); await key('s', 1600)
    await page.waitForFunction(() => window.__spinward.room.coffee.phase === 'holding')
    await key('ArrowDown', 400); await wait(1400); await page.keyboard.press('c'); await wait(2000)
    if (await page.evaluate(() => window.__spinward.room.coffee.servings !== 2)) throw Error('Coffee was not sipped')
    await key('ArrowUp', 400); await key('ArrowLeft', 700); await wait(2200)
  })
  await run('night-street', `t=.9&${pose(0, -200, 1.8, 1.8, -170)}`, null, async ({ key, wait }) => {
    await key('w', 5000); await key('ArrowLeft', 400); await wait(1400); await key('ArrowRight', 800); await wait(1800)
  })
  await run('exterior', 't=.42', async ({ page }) => {
    await page.getByRole('button', { name: 'Exterior', exact: true }).click()
  }, async ({ key, wait }) => {
    await wait(3500); await key('ArrowDown', 550); await wait(2200); await key('ArrowUp', 550); await wait(2800)
  })
  if (errors.length) throw Error(JSON.stringify(errors))
} finally { await browser.close() }
