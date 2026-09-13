import { test, expect } from 'playwright-webxr'
import fs from 'node:fs/promises'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { bulkheadViews, bulkheadPose } from '../neighborhood-life/bulkhead-views.mjs'

test.use({ xrStereoEnabled: true, xrIpd: .064, viewport: { width: 2560, height: 960 } })
for (const name of ['port', 'cladding']) test(`bulkhead ${name} remains opaque and attached in both eyes through head roll`, async ({ page, xr }, info) => {
  const errors = [], frames = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('about:blank')
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2'), d = gl?.getExtension('WEBGL_debug_renderer_info')
    if (!d) throw Error('GPU unknown')
    const renderer = gl.getParameter(d.UNMASKED_RENDERER_WEBGL); gl.getExtension('WEBGL_lose_context')?.loseContext(); return renderer
  })
  expect(gpu).not.toMatch(/SwiftShader|Software|llvmpipe/i)
  await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '', contentType: 'application/javascript' }))
  const view = bulkheadViews.find(v => v.name === name)
  await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&${bulkheadPose(view)}`)
  await page.waitForSelector('#splash', { state: 'detached' })
  await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
  await page.getByRole('button', { name: 'Menu', exact: true }).click(); await xr.enterVR()
  const diagnostics = await xr.diagnostics()
  expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.2.0')
  expect(diagnostics.rendering.views.map(v => v.viewport.width)).toEqual([1280, 1280])
  const probe = () => page.evaluate(() => {
    const cap = window.__spinwardScene.getObjectByName('bulkhead-disks'), frame = window.__spinwardScene.getObjectByName('end-cap-frames')
    return { cap: cap.matrixWorld.elements, frame: frame.matrixWorld.elements,
      triangles: (cap.geometry.index.count + frame.geometry.index.count) / 3,
      capOpaque: !cap.material.transparent && cap.material.opacity === 1,
      frameMap: !!frame.material.map, emission: [cap.material.emissiveIntensity, frame.material.emissiveIntensity],
      shaderKey: cap.material.customProgramCacheKey() }
  })
  const target = await page.evaluate(aim => {
    const scene = window.__spinwardScene, camera = scene.getObjectsByProperty('isPerspectiveCamera', true)[0]
    return camera.parent.worldToLocal(scene.getObjectByName('habitat').localToWorld(camera.position.clone().set(...aim))).toArray()
  }, view.aim)
  const head = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0, 1.6, 0), new Vector3(...target), new Vector3(0, 1, 0)))
  const before = await probe()
  expect(before.triangles).toBe(1520); expect(before.capOpaque).toBe(true)
  expect(before.frameMap).toBe(false); expect(before.emission).toEqual([0, 0])
  expect(before.shaderKey).toContain('bulkhead-metric-panels-v2')
  for (const degrees of [0, 25, -25]) {
    await xr.setHeadPose({ position: [0, 1.6, 0], quaternion: head.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), degrees * Math.PI / 180)).toArray() }); await xr.settle(180)
    expect(await probe()).toEqual(before)
    const projected = await page.evaluate(aim => {
      const scene = window.__spinwardScene, camera = scene.getObjectsByProperty('isPerspectiveCamera', true)[0]
      return scene.getObjectByName('habitat').localToWorld(camera.position.clone().set(...aim)).project(camera).toArray()
    }, view.aim)
    expect(Math.abs(projected[0])).toBeLessThan(.95); expect(Math.abs(projected[1])).toBeLessThan(.95)
    expect(projected[2]).toBeGreaterThan(-1); expect(projected[2]).toBeLessThan(1)
    const path = info.outputPath(`bulkhead-${name}-roll-${degrees}.png`)
    const capture = await xr.screenshot(path, { canvas: 'canvas', metadata: true, timeout: 5000 })
    expect(capture.sessionId).toBe(diagnostics.session.id); expect([capture.width, capture.height]).toEqual([2560, 960])
    await info.attach(`${name}-${degrees}`, { path, contentType: 'image/png' }); frames.push({ degrees, capture, projected })
  }
  const after = await xr.sessionCursor()
  await page.evaluate(() => window.__xrDevice.activeSession.end())
  await xr.waitForSessionEvent('end', { after, sessionId: diagnostics.session.id, timeout: 5000 })
  expect(await xr.sessionMode()).toBeNull(); expect(errors).toEqual([])
  await fs.writeFile(info.outputPath(`bulkhead-${name}.json`), JSON.stringify({ gpu, diagnostics, before, frames, errors }, null, 2))
})
