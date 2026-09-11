// Same-page repeated travel/preset rebuilds. Explicit WebGL resource balance
// and GC-retained JS heap, not GPU byte usage or a frame-rate benchmark.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192'
const output = fileURLToPath(new URL((process.env.PREFIX ?? 'travel-soak') + '.json', import.meta.url))
const cycles = Number(process.env.CYCLES ?? 6), dwell = Number(process.env.DWELL_MS ?? 6000)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const samples = [], errors = [], stability = [], started = Date.now()
const save = () => fs.writeFileSync(output, JSON.stringify({ started, elapsedMs: Date.now() - started, cycles, dwell, errors, stability, samples }, null, 2))
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error' && /shader|WebGLProgram|context.*lost/i.test(m.text())) errors.push(m.text()) })
  await page.addInitScript(() => {
    window.__gpuBalance = {}
    for (const type of ['Buffer', 'Texture', 'Program', 'Shader', 'Framebuffer', 'Renderbuffer', 'VertexArray']) {
      const live = new WeakSet(), counts = window.__gpuBalance[type] = { created: 0, deleted: 0, live: 0 }
      for (const prototype of [window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype]) {
        if (!prototype) continue
        const create = prototype['create' + type], remove = prototype['delete' + type]
        if (!create || !remove || create.__probe) continue
        const wrapped = function (...args) {
          const object = create.apply(this, args)
          if (object && !live.has(object)) { live.add(object); counts.created++; counts.live++ }
          return object
        }
        wrapped.__probe = true
        prototype['create' + type] = wrapped
        prototype['delete' + type] = function (object) {
          if (object && live.delete(object)) { counts.deleted++; counts.live-- }
          return remove.call(this, object)
        }
      }
    }
    addEventListener('webglcontextlost', () => { window.__lostContext = true }, true)
  })
  const cdp = await page.context().newCDPSession(page)
  await page.goto(base + '/?debug&stats&preset=izma&t=.42&dpr=1', { timeout: 60000 })
  await page.waitForSelector('#splash', { state: 'detached', timeout: 60000 })
  await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
  const presets = ['Izma Colony', 'Cooper Station', 'Elysium', 'Playground Colony']
  for (let cycle = 0; cycle < cycles; cycle++) for (const preset of presets) {
    await page.locator('.hud-chip--preset').click()
    await page.locator('.preset-menu:not([hidden])').getByRole('button', { name: preset, exact: true }).click({ timeout: 60000 })
    await page.waitForFunction(preset => document.querySelector('.hud-chip--preset')?.textContent === preset, preset, { timeout: 60000 })
    for (const stop of ['Surface', 'Exterior', 'Surface']) {
      await page.getByRole('button', { name: stop, exact: true }).click({ timeout: 60000 })
      await page.waitForTimeout(dwell)
      await cdp.send('HeapProfiler.collectGarbage')
      const heap = await cdp.send('Runtime.getHeapUsage')
      const state = await page.evaluate(() => ({ gpu: window.__gpuBalance, lost: !!window.__lostContext,
        mode: window.__spinward.mode, radius: window.__spinward.radius, stats: document.querySelector('.stats-overlay')?.textContent,
        walkers: window.__spinwardWalkers.group.userData, body: window.__spinwardBody.group.userData }))
      const sample = { cycle, preset, stop, elapsedMs: Date.now() - started, heap, ...state }
      samples.push(sample); save()
      console.log(JSON.stringify({ cycle, preset, stop, heapMB: +(heap.usedSize / 1048576).toFixed(1), live: Object.fromEntries(Object.entries(state.gpu).map(([k, v]) => [k, v.live])) }))
      if (state.lost || errors.length) throw Error(JSON.stringify({ state, errors }))
    }
  }
  if (cycles >= 4) for (const preset of presets) {
    const settled = cycle => samples.filter(s => s.cycle === cycle && s.preset === preset && s.stop === 'Surface').at(-1)
    const initial = settled(2), final = settled(cycles - 1)
    const growth = Object.fromEntries(Object.keys(initial.gpu).map(k => [k, final.gpu[k].live - initial.gpu[k].live]))
    stability.push({ preset, growth, heapGrowthMB: (final.heap.usedSize - initial.heap.usedSize) / 1048576 })
    // Leave room for a few late visible assets/variants; continuing growth of
    // 41 buffers per tour exceeded this by more than an order of magnitude.
    if (process.env.EXPECT_STABLE && (growth.Buffer > 8 || growth.Texture > 2 || growth.Program > 8 || growth.Framebuffer > 0 || growth.Renderbuffer > 0)) {
      throw Error('Resources keep accumulating after warm-up: ' + JSON.stringify(stability.at(-1)))
    }
  }
} catch (error) {
  errors.push(String(error)); save(); throw error
} finally { save(); await browser.close() }
