import { test, expect } from 'playwright-webxr'
import { Matrix4, Quaternion, Vector3 } from 'three'
import fs from 'node:fs/promises'

const leftPose = {
  position: [-.1, 1.42, -.4],
  quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI/2)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI/2)).toArray()
}
const rightPosition = [.22, 1.38, -.2]
const distance = (a, b) => Math.hypot(Math.atan2(Math.sin(a.azimuth-b.azimuth), Math.cos(a.azimuth-b.azimuth))*b.radius, a.axial-b.axial)

// Only read layout/transform probes. Selection always travels through IWER
// target-ray poses → Three's raycast → the real controller trigger event.
async function panelPose(page, id, uv) {
  return page.evaluate(({ id, uv }) => {
    const w = window.__spinwardWatch, layout = w.layouts[w.screen]
    const button = id ? layout.buttons.find(b => b.id === id) : null
    if (id && !button) throw Error('Missing wrist target ' + id)
    const camera = window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera', true)[0]
    return {
      u: uv?.[0] ?? (button.x+button.width/2)/layout.width,
      v: uv?.[1] ?? 1-(button.y+button.height/2)/layout.height,
      panel: w.interactiveObject.matrixWorld.elements,
      rig: camera.parent.matrixWorld.elements
    }
  }, { id, uv })
}
const trackingMatrix = pose => new Matrix4().fromArray(pose.rig).invert().multiply(new Matrix4().fromArray(pose.panel))
async function aim(page, xr, id, { disabled = false, uv } = {}) {
  const pose = await panelPose(page, id, uv)
  const direction = new Vector3(pose.u-.5, pose.v-.5, 0).applyMatrix4(trackingMatrix(pose))
    .sub(new Vector3(...rightPosition)).normalize()
  await xr.setControllerPose('right', { position: rightPosition,
    quaternion: new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), direction).toArray() })
  await xr.settle(90)
  await expect.poll(() => page.evaluate(() => window.__spinwardWatch.hoveredAction)).toBe(disabled || uv ? null : id)
}
async function press(page, xr, id, options) {
  await aim(page, xr, id, options)
  await xr.pressButton('right', 'trigger')
}
async function capture(xr, info, name) {
  const path = info.outputPath(name+'.png')
  const metadata = await xr.screenshot(path, { canvas: 'canvas', timeout: 5000, metadata: true })
  expect(metadata.width).toBe(info.titlePath.includes('quest-entry') ? 2560 : 1280)
  expect(metadata.height).toBe(960)
  expect(metadata.capture).toBe('canvas')
  expect(metadata.sessionId).toBe((await xr.diagnostics()).session.id)
  await info.attach(name+'-metadata', { body: JSON.stringify(metadata), contentType: 'application/json' })
  expect((await fs.stat(path)).size, 'XR frame is not an empty canvas').toBeGreaterThan(25_000)
  await info.attach(name, { path, contentType: 'image/png' })
}
async function captureTexture(page, info, name) {
  const data = await page.evaluate(() => window.__spinwardWatch.interactiveObject.material.map.image.toDataURL('image/png'))
  const path = info.outputPath(name+'-texture.png')
  await fs.writeFile(path, Buffer.from(data.split(',')[1], 'base64'))
  await info.attach(name+'-texture', { path, contentType: 'image/png' })
}
async function tourVisible(page) {
  return page.evaluate(() => {
    const panels = window.__spinwardScene.getObjectsByProperty('renderOrder', 30).filter(o => o.isMesh)
    if (panels.length !== 1) throw Error('Expected exactly one spatial tour panel')
    return panels[0].visible
  })
}

for (const entry of ['desktop-menu', 'quest-entry']) {
  test.describe(entry, () => {
    if (entry === 'quest-entry') test.use({
      hasTouch: true,
      xrStereoEnabled: true,
      xrIpd: .064,
      viewport: { width: 2560, height: 960 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) OculusBrowser/40.0.0.0'
    })
    test('VR wrist UI, input ownership and session return', async ({ page, xr }, info) => {
      const errors = [], failedResources = [], evidence = { entry, rolls: [] }
      page.on('pageerror', e => { errors.push(e.message); console.error('Browser error:', e.message) })
      page.on('response', r => { if (r.status() >= 400) failedResources.push({ status: r.status(), url: r.url() }) })
      // Probe before loading the full colony. Keep emulated UI verification
      // distinct from both software rendering and physical-headset performance.
      await page.goto('about:blank')
      evidence.gpu = await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2')
        if (!gl) throw Error('WebGL2 unavailable')
        const debug = gl.getExtension('WEBGL_debug_renderer_info')
        if (!debug) throw Error('Cannot verify the active GPU: renderer information unavailable')
        const name = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        gl.getExtension('WEBGL_lose_context')?.loseContext()
        return name
      })
      expect(evidence.gpu).not.toMatch(/SwiftShader|llvmpipe|Software/i)
      // Local preview has no analytics backend; do not send test visits to RUM.
      await page.route('https://static.cloudflareinsights.com/**', route => route.fulfill({ status: 200, body: '', contentType: 'application/javascript' }))
      await page.goto('/?debug&lock=0&t=.42&tier=quest&dpr=1&metrics=off')
      await page.waitForSelector('#splash', { state: 'detached' })
      await page.waitForFunction(() => window.__spinwardBody?.group.userData.ready)
      await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
      expect(await xr.runtimeInstalled()).toBe(true)
      if (entry === 'desktop-menu') await page.getByRole('button', { name: 'Menu', exact: true }).click()
      else {
        await expect(page.locator('body')).toHaveClass(/is-vr-entry/)
        const box = await page.locator('#VRButton').boundingBox()
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0)
        expect(Math.abs(box.x+box.width/2-page.viewportSize().width/2)).toBeLessThan(2)
      }
      await expect(page.locator('#VRButton')).toBeVisible()
      const firstCursor = await xr.sessionCursor()
      await xr.enterVR()
      const [firstGrant] = await xr.waitForSessionEvent('granted', { after: firstCursor, timeout: 5000 })
      expect(await xr.sessionMode()).toBe('immersive-vr')
      await page.waitForFunction(() => window.__spinwardWatch?.group.visible)
      expect((await xr.sessionLog()).some(e => e.event === 'granted' && e.detail === 'immersive-vr')).toBe(true)
      await expect(page.locator('.dock')).toBeHidden()
      await expect(page.locator('.tour-notice')).toBeHidden()
      evidence.session = await xr.diagnostics({ canvas: 'canvas', timeout: 2000 })
      const { runtime, rendering, inputSources, session } = evidence.session
      expect(runtime.playwrightWebxrVersion).toBe('0.2.0')
      expect(runtime.stereoEnabled).toBe(entry === 'quest-entry')
      expect(runtime.ipd).toBeCloseTo(entry === 'quest-entry' ? .064 : 0, 5)
      expect(session.id).toBe(firstGrant.sessionId)
      expect(rendering.baseLayer.type).toBe('XRWebGLLayer')
      expect(rendering.canvas.matchesBaseLayer).toBe(true)
      // Unavailable layers are unknown, never silently equated to zero.
      if (rendering.layers === null) {
        expect(rendering.projectionLayerCount).toBeNull()
        expect(rendering.layersReason).toBeTruthy()
      }
      expect(rendering.views.map(v => v.eye)).toEqual(['left', 'right'])
      expect(inputSources.map(s => s.handedness).sort()).toEqual(['left', 'right'])
      expect(rendering.views[0].viewport).toEqual({ x: 0, y: 0, width: 1280, height: 960 })
      expect(rendering.views[1].viewport.width).toBe(entry === 'quest-entry' ? 1280 : 0)
      await xr.setHeadPose({ position: [0, 1.6, 0], euler: [-.22, 0, 0] })
      await xr.setControllerPose('left', leftPose)
      await xr.setControllerPose('right', { position: rightPosition, quaternion: [0, 0, 0, 1] })
      await xr.settle(180)
      // Catch the actual introductory-card overlap, not a card that timed out.
      expect(await page.evaluate(() => window.__spinward.tour)).toBe('start')
      expect(await tourVisible(page)).toBe(true)
      await aim(page, xr, 'nav-places')
      await expect.poll(() => tourVisible(page)).toBe(false)
      await expect.poll(() => page.evaluate(() => window.__spinwardScene.getObjectsByProperty('name', 'ray').filter(r => r.visible).length)).toBe(0)
      await capture(xr, info, 'wrist-home-focused')
      await xr.pressButton('right', 'trigger')
      await page.waitForFunction(() => window.__spinwardWatch.screen === 'places')
      await capture(xr, info, 'wrist-places')
      await captureTexture(page, info, 'wrist-places')
      const initialPanel = trackingMatrix(await panelPose(page, 'nav-home')).elements
      for (const degrees of [0, 25, -25]) {
        await xr.setHeadPose({ euler: [-.22, 0, degrees*Math.PI/180] }); await xr.settle(300)
        const matrix = trackingMatrix(await panelPose(page, 'nav-home')).elements
        const error = Math.max(...matrix.map((value, i) => Math.abs(value-initialPanel[i])))
        expect(error, 'The watch stays on the wrist when the head rolls').toBeLessThan(.0001)
        await press(page, xr, 'nav-home'); await page.waitForFunction(() => window.__spinwardWatch.screen === 'home')
        await press(page, xr, 'nav-places'); await page.waitForFunction(() => window.__spinwardWatch.screen === 'places')
        await capture(xr, info, `wrist-roll-${degrees}`)
        evidence.rolls.push({ degrees, trackingMatrixError: error })
      }
      await xr.setHeadPose({ euler: [-.22, 0, 0] })
      await press(page, xr, 'nav-outing'); await page.waitForFunction(() => window.__spinwardWatch.screen === 'outing')
      const before = await page.evaluate(() => window.__spinward)
      await press(page, xr, 'guide-cafe')
      await page.waitForFunction(() => window.__spinward.outing.action === 'guide-cafe')
      expect(distance(before, await page.evaluate(() => window.__spinward))).toBeLessThan(.15)
      await capture(xr, info, 'wrist-directions')
      await press(page, xr, 'guide-cancel'); await page.waitForFunction(() => window.__spinward.outing.action === null)
      const ballCount = () => page.evaluate(() => window.__spinwardWatch.snapshot.ballCount)
      const initialBalls = await ballCount()
      await press(page, xr, 'park-car', { disabled: true })
      await xr.settle(150)
      expect(await ballCount(), 'Disabled wrist controls must not throw through the panel').toBe(initialBalls)
      expect(await page.evaluate(() => window.__spinward.drive.driving)).toBe(false)
      await press(page, xr, null, { uv: [.98, .02] })
      await xr.settle(150)
      expect(await ballCount(), 'Panel padding must also own its trigger input').toBe(initialBalls)
      await press(page, xr, 'nav-home'); await page.waitForFunction(() => window.__spinwardWatch.screen === 'home')
      await press(page, xr, 'weather-rain-toggle'); await page.waitForFunction(() => window.__spinward.raining)
      await press(page, xr, 'weather-rain-toggle'); await page.waitForFunction(() => !window.__spinward.raining)
      await press(page, xr, 'nav-legend'); await page.waitForFunction(() => window.__spinwardWatch.screen === 'legend')
      await capture(xr, info, 'wrist-controls')
      await captureTexture(page, info, 'wrist-controls')
      await press(page, xr, 'nav-home')
      // Leaving the UI restores the world's trigger interaction.
      await xr.setControllerPose('right', { position: [.4, 1.4, -.2], quaternion: [0, 0, 0, 1] })
      await xr.settle(150)
      await expect.poll(() => page.evaluate(() => window.__spinwardScene.getObjectsByProperty('name', 'ray').filter(r => r.visible).length)).toBe(1)
      await xr.pressButton('right', 'trigger')
      await expect.poll(ballCount).toBe(initialBalls+1)
      // End as the headset system would; the in-session DOM VR button is hidden.
      const endCursor = await xr.sessionCursor()
      await page.evaluate(() => window.__xrDevice.activeSession.end())
      await xr.waitForSessionEvent('end', { after: endCursor, sessionId: firstGrant.sessionId, timeout: 5000 })
      expect(await xr.sessionMode()).toBeNull()
      await expect(page.locator('.dock')).toBeVisible()
      await page.waitForFunction(() => !window.__spinwardWatch.group.visible)
      const secondCursor = await xr.sessionCursor()
      await page.getByRole('button', { name: 'Menu', exact: true }).click(); await xr.enterVR()
      const [secondGrant] = await xr.waitForSessionEvent('granted', { after: secondCursor, timeout: 5000 })
      expect(secondGrant.sessionId).not.toBe(firstGrant.sessionId)
      expect(await xr.sessionMode()).toBe('immersive-vr')
      await page.waitForFunction(() => window.__spinwardWatch.group.visible)
      await expect(page.locator('.dock')).toBeHidden()
      await press(page, xr, 'nav-places'); await page.waitForFunction(() => window.__spinwardWatch.screen === 'places')
      const secondEndCursor = await xr.sessionCursor()
      await page.evaluate(() => window.__xrDevice.activeSession.end())
      await xr.waitForSessionEvent('end', { after: secondEndCursor, sessionId: secondGrant.sessionId, timeout: 5000 })
      expect(await xr.sessionMode()).toBeNull()
      evidence.sessionLog = await xr.sessionLog()
      expect(evidence.sessionLog.filter(e => e.event === 'granted')).toHaveLength(2)
      expect(evidence.sessionLog.filter(e => e.event === 'end')).toHaveLength(2)
      await expect(page.locator('.dock')).toBeVisible()
      expect(errors).toEqual([]); expect(failedResources).toEqual([])
      await fs.writeFile(info.outputPath('evidence.json'), JSON.stringify({ ...evidence, errors, failedResources }, null, 2))
      console.log(JSON.stringify({ entry, gpu: evidence.gpu, session: evidence.session, rolls: evidence.rolls }))
    })
  })
}
