import { test, expect } from 'playwright-webxr'
import fs from 'node:fs/promises'
import { skylineViews, skylinePose } from '../neighborhood-life/skyline-views.mjs'

test.use({ xrStereoEnabled: true, xrIpd: .064, viewport: { width: 2560, height: 960 } })

test('varied city masses remain fixed in both eyes through head roll', async ({ page, xr }, info) => {
  const errors = [], frames = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('about:blank')
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2'), d = gl?.getExtension('WEBGL_debug_renderer_info')
    if (!d) throw Error('Cannot verify hardware GPU')
    const renderer = gl.getParameter(d.UNMASKED_RENDERER_WEBGL)
    gl.getExtension('WEBGL_lose_context')?.loseContext(); return renderer
  })
  expect(gpu).not.toMatch(/SwiftShader|Software|llvmpipe/i)
  await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '', contentType: 'application/javascript' }))
  await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&${skylinePose(skylineViews[0])}`)
  await page.waitForSelector('#splash', { state: 'detached' })
  await page.waitForFunction(() => !!window.__spinwardCity?.colonyBuildings?.modules)
  await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await xr.enterVR()
  const diagnostics = await xr.diagnostics()
  expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.2.0')
  expect(diagnostics.rendering.views.map(v => v.viewport.width)).toEqual([1280, 1280])
  await expect.poll(() => page.evaluate(() => window.__spinwardScene.getObjectsByProperty('renderOrder', 30).filter(o => o.isMesh).every(o => !o.visible)), { timeout: 30000 }).toBe(true)
  const probe = () => page.evaluate(() => {
    const layer = window.__spinwardCity.colonyBuildings
    return layer.entries.filter(e => e.visible && !e.interior && Math.abs(e.spec.building.axial) < 400 && Math.abs(e.spec.building.azimuth) < .15)
      .slice(0, 30).map(e => ({ a: e.spec.building.azimuth, ax: e.spec.building.axial, parts: e.parts.map(p => {
        const mesh = layer.structures.get(p.kind).mesh, matrix = mesh.matrix.clone()
        mesh.getMatrixAt(p.slot.index, matrix); return matrix.elements
      }) }))
  })
  const before = await probe()
  expect(before.length).toBeGreaterThan(10)
  for (const degrees of [0, 25, -25]) {
    await xr.setHeadPose({ position: [0, 1.6, 0], euler: [0, 0, degrees * Math.PI / 180] })
    await xr.settle(200)
    expect(await probe()).toEqual(before)
    const path = info.outputPath(`skyline-roll-${degrees}.png`)
    const capture = await xr.screenshot(path, { metadata: true, canvas: 'canvas', timeout: 5000 })
    expect(capture.sessionId).toBe(diagnostics.session.id)
    expect([capture.width, capture.height]).toEqual([2560, 960])
    await info.attach(`skyline-roll-${degrees}`, { path, contentType: 'image/png' })
    frames.push({ degrees, capture })
  }
  const after = await xr.sessionCursor()
  await page.evaluate(() => window.__xrDevice.activeSession.end())
  await xr.waitForSessionEvent('end', { after, sessionId: diagnostics.session.id, timeout: 5000 })
  expect(await xr.sessionMode()).toBeNull()
  expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('skyline-evidence.json'), JSON.stringify({ diagnostics, gpu, frames, buildings: before, errors }, null, 2))
})
