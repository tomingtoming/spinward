import { test, expect } from 'playwright-webxr'
import fs from 'node:fs/promises'

test.use({ xrStereoEnabled: true, xrIpd: .064, viewport: { width: 2560, height: 960 } })
for (const failure of ['missing', 'corrupt']) test(`colony data: ${failure} part prevents partial startup and reload recovers VR`, async ({ page, xr }, info) => {
  const pattern = '**/landscapes/izma/data-*.json'
  let injected = false
  await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '' }))
  await page.route(pattern, async route => {
    if (injected) return route.continue()
    injected = true
    if (failure === 'missing') return route.fulfill({ status: 404, body: 'Missing test part' })
    const response = await route.fetch(), bytes = await response.body()
    // Same length and valid JSON: integrity, not JSON syntax, must reject it.
    const text = bytes.toString('utf8'), index = text.search(/[0-9]/)
    expect(index).toBeGreaterThanOrEqual(0)
    bytes[index] = bytes[index] === 49 ? 50 : 49
    await route.fulfill({ response, body: bytes })
  })
  await page.goto('/?debug&metrics=off&lock=0&dpr=1&tier=quest&landscape=authored&preset=izma&t=.42')
  await expect(page.locator('.splash__reload')).toBeVisible()
  await expect(page.locator('.splash__error-detail')).toHaveText('The colony could not be loaded. Please check your connection and reload.')
  expect(injected).toBe(true)
  expect(await page.evaluate(() => !!window.__spinwardCity)).toBe(false)
  await page.screenshot({ path: info.outputPath('failed-startup.png') })
  await page.unroute(pattern)
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.locator('.splash__reload').click()
  await page.waitForSelector('#splash', { state: 'detached', timeout: 60000 })
  await page.waitForFunction(() => window.__spinwardCity?.authoredColony.group.userData.pending === 0)
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await xr.enterVR()
  const diagnostics = await xr.diagnostics()
  expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.3.0')
  const renderer = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info')
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'
  })
  expect(renderer).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  const state = await page.evaluate(() => ({ mode: window.__spinward.mode, colony: window.__spinwardCity.authoredColony.group.userData }))
  expect(state.mode).toBe('grounded'); expect(state.colony.failed).toEqual([])
  expect(state.colony.neighbourhoodBuildings).toBe(5679)
  const capture = await xr.screenshot(info.outputPath('recovered-vr.png'), { canvas: 'canvas', metadata: true, timeout: 5000 })
  await xr.endSession({ sessionId: diagnostics.session.id, timeout: 5000 })
  expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('report.json'), JSON.stringify({ failure, renderer, diagnostics, state, capture, errors }, null, 2))
})
