import { test, expect } from 'playwright-webxr'
import { Matrix4, Quaternion, Vector3 } from 'three'
import fs from 'node:fs/promises'

test.use({ xrStereoEnabled: true, xrIpd: .064, viewport: { width: 2560, height: 960 } })

// A view of the same mixed-use tower in both desktop and Quest city budgets.
// Enter the real XR session at the public free-flight URL, without moving meshes.
const point = (a, ax, h) => new Vector3(Math.cos(a) * (3200 - h), ax, Math.sin(a) * (3200 - h))
const at = [.0536, -17378.2, 39.2], target = [.05299, -17385.35, 38.8]
const position = point(...at)
const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(position, point(...target), new Vector3(-Math.cos(at[0]), 0, -Math.sin(at[0]))))

async function roomProbe(page) {
  return page.evaluate(() => {
    const layer = window.__spinwardCity.oldTownBlock
    const entry = layer.entries.find(e => e.parts.some(p => p.module === 'roof_plant_room'))
    const part = entry.parts.find(p => p.module === 'roof_plant_room')
    const mesh = layer.group.getObjectByName('old-town-roof_plant_room')
    if (!mesh?.visible || mesh.count !== 1) throw Error('Expected the nearby plant room in the detailed batch')
    const matrix = entry.matrix.clone(); mesh.getMatrixAt(0, matrix)
    const camera = window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera', true)[0]
    const centre = camera.position.clone().set(0, .5, 0).applyMatrix4(matrix)
    return { matrix: matrix.elements, projected: centre.clone().project(camera).toArray(),
      part, colliders: layer.getColliders().length, mode: window.__spinward.mode }
  })
}

test('roof services remain attached in stereo through head roll', async ({ page, xr }, info) => {
  const errors = [], evidence = { frames: [] }
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('about:blank')
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2'), debug = gl?.getExtension('WEBGL_debug_renderer_info')
    if (!debug) throw Error('Cannot verify hardware GPU')
    const renderer = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
    gl.getExtension('WEBGL_lose_context')?.loseContext(); return renderer
  })
  expect(gpu).not.toMatch(/SwiftShader|llvmpipe|Software/i)
  await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '', contentType: 'application/javascript' }))
  await page.goto(`/?debug&lock=0&metrics=off&tier=quest&dpr=1&t=.42&m=f&rpm=0&p=${position.toArray()}&q=${rotation.toArray()}`)
  await page.waitForSelector('#splash', { state: 'detached' })
  await page.waitForFunction(() => window.__spinwardCity?.oldTownBlock?.group.userData.ready)
  await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await xr.enterVR()
  const diagnostics = await xr.diagnostics()
  expect(diagnostics.runtime.playwrightWebxrVersion).toBe('0.2.0')
  expect(diagnostics.rendering.views.map(v => v.viewport.width)).toEqual([1280, 1280])
  // Let the ordinary first-entry card finish; do not hide scene UI by mutation.
  await expect.poll(() => page.evaluate(() => window.__spinwardScene.getObjectsByProperty('renderOrder', 30).filter(o => o.isMesh).every(o => !o.visible)), { timeout: 30000 }).toBe(true)
  const before = await roomProbe(page)
  for (const degrees of [0, 25, -25]) {
    await xr.setHeadPose({ position: [0, 1.6, 0], euler: [0, 0, degrees * Math.PI / 180] })
    await xr.settle(200)
    const probe = await roomProbe(page)
    expect(Math.max(...probe.matrix.map((v, i) => Math.abs(v - before.matrix[i])))).toBeLessThan(1e-8)
    expect(Math.abs(probe.projected[0])).toBeLessThan(.95)
    expect(Math.abs(probe.projected[1])).toBeLessThan(.95)
    expect(probe.projected[2]).toBeGreaterThan(-1); expect(probe.projected[2]).toBeLessThan(1)
    const path = info.outputPath(`roof-roll-${degrees}.png`)
    const capture = await xr.screenshot(path, { metadata: true, canvas: 'canvas', timeout: 5000 })
    expect(capture.sessionId).toBe(diagnostics.session.id)
    expect([capture.width, capture.height]).toEqual([2560, 960])
    await info.attach(`roof-roll-${degrees}`, { path, contentType: 'image/png' })
    evidence.frames.push({ degrees, probe, capture })
  }
  const after = await xr.sessionCursor()
  await page.evaluate(() => window.__xrDevice.activeSession.end())
  await xr.waitForSessionEvent('end', { after, sessionId: diagnostics.session.id, timeout: 5000 })
  expect(await xr.sessionMode()).toBeNull()
  expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('roof-evidence.json'), JSON.stringify({ ...evidence, diagnostics, gpu, errors }, null, 2))
})
