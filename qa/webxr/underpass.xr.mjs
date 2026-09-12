import { test, expect } from 'playwright-webxr'
import fs from 'node:fs/promises'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { underpassViews, underpassPose } from '../neighborhood-life/underpass-views.mjs'

test.use({ xrStereoEnabled: true, xrIpd: .064, viewport: { width: 2560, height: 960 } })

test('covered walk stays grounded and world-fixed in stereo through head roll', async ({ page, xr }, info) => {
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
  await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&${underpassPose(underpassViews[1])}`)
  await page.waitForSelector('#splash', { state: 'detached' })
  await page.waitForFunction(() => !!window.__spinwardCity?.civicDetails.underpass)
  await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await xr.enterVR()
  const diagnostics = await xr.diagnostics()
  expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.2.0')
  expect(diagnostics.rendering.views.map(v => v.viewport.width)).toEqual([1280, 1280])
  await expect.poll(() => page.evaluate(() => window.__spinwardScene.getObjectsByProperty('renderOrder', 30).filter(o => o.isMesh).every(o => !o.visible)), { timeout: 30000 }).toBe(true)
  // Grounded VR entry has its own heading; the desktop URL's look quaternion
  // is not the headset orientation. Aim in the actual tracking frame, then
  // assert that the walkway is on screen instead of passing an off-camera test.
  const trackingTarget = await page.evaluate(() => {
    const city = window.__spinwardCity, a = window.__spinward.azimuth + 25 / 3200
    const camera = window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera', true)[0]
    const target = camera.position.clone().set(Math.cos(a) * (3200 - 1.4), city.civicDetails.underpass.axial, Math.sin(a) * (3200 - 1.4))
    return camera.parent.worldToLocal(city.group.localToWorld(target)).toArray()
  })
  const head = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0, 1.6, 0), new Vector3(...trackingTarget), new Vector3(0, 1, 0)))
  const probe = () => page.evaluate(() => ({
    group: window.__spinwardCity.civicDetails.group.matrix.elements,
    plan: window.__spinwardCity.civicDetails.underpass,
    h: window.__spinward.groundHeight,
    triangles: window.__spinwardCity.civicDetails.group.userData.underpassTriangles
  }))
  const before = await probe()
  expect(before.h).toBeCloseTo(.34, 2)
  expect(before.triangles).toBeGreaterThan(0)
  expect(before.triangles).toBeLessThanOrEqual(4096)
  for (const degrees of [0, 25, -25]) {
    await xr.setHeadPose({ position: [0, 1.6, 0], quaternion: head.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), degrees * Math.PI / 180)).toArray() })
    await xr.settle(200)
    expect(await probe()).toEqual(before)
    const projected = await page.evaluate(() => {
      const city = window.__spinwardCity, camera = window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera', true)[0]
      return [10, 35].map(distance => {
        const a = window.__spinward.azimuth + distance / 3200
        const point = camera.position.clone().set(Math.cos(a) * (3200 - .34), city.civicDetails.underpass.axial, Math.sin(a) * (3200 - .34))
        return city.group.localToWorld(point).project(camera).toArray()
      })
    })
    for (const [x, y, z] of projected) {
      expect(Math.abs(x)).toBeLessThan(.98); expect(Math.abs(y)).toBeLessThan(.98)
      expect(z).toBeGreaterThan(-1); expect(z).toBeLessThan(1)
    }
    const path = info.outputPath(`underpass-roll-${degrees}.png`)
    const capture = await xr.screenshot(path, { metadata: true, canvas: 'canvas', timeout: 5000 })
    expect(capture.sessionId).toBe(diagnostics.session.id)
    expect([capture.width, capture.height]).toEqual([2560, 960])
    await info.attach(`underpass-roll-${degrees}`, { path, contentType: 'image/png' })
    frames.push({ degrees, capture, projected })
  }
  const after = await xr.sessionCursor()
  await page.evaluate(() => window.__xrDevice.activeSession.end())
  await xr.waitForSessionEvent('end', { after, sessionId: diagnostics.session.id, timeout: 5000 })
  expect(await xr.sessionMode()).toBeNull()
  expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('underpass-evidence.json'), JSON.stringify({ diagnostics, gpu, frames, before, errors }, null, 2))
})
