import { test, expect } from 'playwright-webxr'
import { aimQuaternion } from 'playwright-webxr/examples/aim-controller'
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Raycaster, Vector3 } from 'three'
import fs from 'node:fs/promises'

const { stations } = JSON.parse(await fs.readFile(new URL('../../assets/blender/izma-rail.json', import.meta.url), 'utf8'))
test.use({ xrStereoEnabled: true, xrIpd: .064, viewport: { width: 2560, height: 960 } })
for (const id of ['a-civic', 'b-housing', 'c-market']) test(`station approach: ${id} street to platform with VR stick`, async ({ page, xr }, info) => {
  test.setTimeout(150000)
  const station = stations.find(s => s.id === id), errors = [], samples = [], captures = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '' }))
  await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&landscape=authored&preset=izma&t=${station.band === 2 ? .9 : .42}&visit=station-${id}`)
  await page.waitForSelector('#splash', { state: 'detached' })
  await page.waitForFunction(() => window.__spinwardCity.authoredColony.group.userData.pending === 0)
  const drawing = await page.evaluate(centre => {
    const gl = document.querySelector('canvas').getContext('webgl2'), d = gl.getExtension('WEBGL_debug_renderer_info'), positions = []
    const colony = window.__spinwardCity.authoredColony.group
    for (const mesh of [...colony.getObjectByName('colony-station-ground').children,
      ...colony.getObjectByName('colony-base').children.filter(m => /-(local|arterial|walk|ballast)$/.test(m.name))]) {
      const v = mesh.geometry.attributes.position.array
      for (let i = 0; i < v.length; i += 9) {
        const a = Math.atan2(v[i + 2], v[i]) - centre[0] / 3200
        if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a)) * 3200) < 120 && Math.abs(v[i + 1] - centre[1]) < 120)
          for (let j = 0; j < 9; j++) positions.push(v[i + j])
      }
    }
    return { gpu: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown', positions }
  }, station.position)
  expect(drawing.gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(Float32Array.from(drawing.positions), 3))
  const material = new MeshBasicMaterial({ side: DoubleSide }), floor = new Mesh(geometry, material)
  const sample = async () => {
    const s = await page.evaluate(() => ({ ...window.__spinward, colony: window.__spinwardCity.authoredColony.group.userData }))
    s.x = s.azimuth * 3200; s.x += Math.round((station.entry[0] - s.x) / (Math.PI * 6400)) * Math.PI * 6400
    const out = new Vector3(Math.cos(s.azimuth), 0, Math.sin(s.azimuth)), origin = out.clone().multiplyScalar(3200 - s.groundHeight - .2); origin.y = s.axial
    const hit = new Raycaster(origin, out, 0, 1).intersectObject(floor)[0]
    expect(hit, 'drawn approach or platform supports the walker').toBeDefined()
    const h = 3200 - Math.hypot(hit.point.x, hit.point.z)
    expect(Math.abs(s.groundHeight - h)).toBeLessThan(.18)
    expect(s.mode).toBe('grounded'); expect(s.rail.rider).toBeNull()
    expect(s.colony.failed).toEqual([]); expect(s.colony.loaded).toBeLessThanOrEqual(18)
    samples.push({ ...s, drawnHeight: h }); return s
  }
  const aim = async ([x, y, h]) => {
    const target = await page.evaluate(([x, y, h]) => {
      const c = window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera', true)[0]
      const p = c.position.clone().set(Math.cos(x / 3200) * (3200 - h - 1.6), y, Math.sin(x / 3200) * (3200 - h - 1.6))
      return c.parent.worldToLocal(window.__spinwardCity.group.localToWorld(p)).toArray()
    }, [x, y, h])
    await xr.setHeadPose({ position: [0, 1.6, 0], quaternion: new Quaternion().setFromRotationMatrix(
      new Matrix4().lookAt(new Vector3(0, 1.6, 0), new Vector3(...target), new Vector3(0, 1, 0))).toArray() })
  }
  const capture = async name => captures.push(await xr.screenshot(info.outputPath(name + '.png'), { canvas: 'canvas', metadata: true, timeout: 5000 }))
  try {
    await page.getByRole('button', { name: 'Menu', exact: true }).click(); await xr.enterVR()
    const diagnostic = await xr.diagnostics(); expect(diagnostic.runtime.playwrightWebxrVersion).toBe('0.3.0')
    await xr.setControllerPose('left', { position: [-.4, .6, -.2], quaternion: [0, 0, 0, 1] })
    const start = await sample(); await aim(station.approach[10]); await capture('street')
    const path = station.approach, targets = path.filter((p, i) => {
      if (i % 6 === 0 || i >= path.length - 3) return true
      if (i === 0 || i === path.length - 1) return false
      const a = path[i - 1], b = path[i + 1], first = Math.atan2(p[0] - a[0], p[1] - a[1]), last = Math.atan2(b[0] - p[0], b[1] - p[1])
      return Math.abs(Math.atan2(Math.sin(last - first), Math.cos(last - first))) > .12
    }).slice(1)
    for (const target of targets) {
      let arrived = false
      for (let i = 0; i < 65; i++) {
        const s = await sample(), remaining = Math.hypot(s.x - target[0], s.axial - target[1])
        if (remaining < .15) { arrived = true; break }
        await aim(target); await xr.setAxes('left', 0, -Math.min(.85, Math.max(.15, remaining / 4))); await xr.settle(180)
        // Stop the previous heading before evaluating/aiming the next corner.
        // A live axis during CDP round trips can walk off the narrow island.
        await xr.setAxes('left', 0, 0)
      }
      expect(arrived, `walk to ${target}`).toBe(true)
    }
    await xr.setAxes('left', 0, 0); await xr.settle(200)
    const end = await sample(); expect(Math.abs(end.groundHeight - station.platform[2])).toBeLessThan(.1)
    expect(Math.hypot(end.x - start.x, end.axial - start.axial)).toBeGreaterThan(35)
    await aim(station.entry); await capture('platform-looking-back')
    await xr.endSession({ sessionId: diagnostic.session.id, timeout: 5000 })
    expect(errors).toEqual([])
    await fs.writeFile(info.outputPath('report.json'), JSON.stringify({ diagnostic, start, end, captures }, null, 2))
  } finally { geometry.dispose(); material.dispose(); await fs.writeFile(info.outputPath('samples.json'), JSON.stringify({ samples, errors }, null, 2)) }
})

test('tram: real VR boarding, continuous inter-district ride, alighting and wrist return', async ({ page, xr }, info) => {
  test.setTimeout(600000)
  const station = stations.find(s => s.id === 'a-civic'), start = station.boarding[0]
  const errors = [], failures = [], samples = [], captures = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('requestfailed', r => { if (!r.failure()?.errorText.includes('ERR_ABORTED')) failures.push(r.url() + ': ' + r.failure()?.errorText) })
  await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '' }))
  await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&landscape=authored&preset=izma&t=.42&m=g&a=${start[0] / 3200}&ax=${start[1]}&gh=${start[2]}`)
  await page.waitForSelector('#splash', { state: 'detached' })
  await page.waitForFunction(() => window.__spinwardCity.authoredColony.group.userData.pending === 0)
  const gpu = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2'), d = gl.getExtension('WEBGL_debug_renderer_info')
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'
  })
  expect(gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  const sample = async () => {
    const s = await page.evaluate(() => {
      const s = window.__spinward, r = window.__spinwardRail, t = r.ride.train
      const slot = t && r.rail.slots.find(v => v.id === t.id)
      return { ...s, matrix: slot?.root.matrix.elements, localU: r.ride.active?.u,
        train: t && { id: t.id, position: t.position, station: t.station?.id, next: t.next.id, arrivalIn: t.arrivalIn },
        colony: window.__spinwardCity.authoredColony.group.userData,
        activeLights: window.__spinwardCity.authoredLandscape.group.userData.activeLights }
    })
    expect(s.colony.loaded).toBeLessThanOrEqual(18); expect(s.colony.pending).toBeLessThanOrEqual(3)
    expect(s.colony.failed).toEqual([]); expect(s.activeLights).toBeLessThanOrEqual(6)
    expect(s.rail.bodies).toBeLessThanOrEqual(3); expect(s.rail.colliders).toBeLessThanOrEqual(15)
    if (s.rail.rider) {
      const floor = new Vector3(-s.localU, .62, 0).applyMatrix4(new Matrix4().fromArray(s.matrix))
      const actual = new Vector3(Math.cos(s.azimuth) * (3200 - s.groundHeight), s.axial, Math.sin(s.azimuth) * (3200 - s.groundHeight))
      expect(actual.distanceTo(floor), 'body floor follows the visible moving car').toBeLessThan(.015)
      expect(s.room.sensor).toBe(true); expect(s.mode).toBe('grounded')
    }
    samples.push(s); return s
  }
  const trackingPoint = point => page.evaluate(([x, y, h]) => {
    const camera = window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera', true)[0]
    const p = camera.position.clone().set(Math.cos(x / 3200) * (3200 - h), y, Math.sin(x / 3200) * (3200 - h))
    return camera.parent.worldToLocal(window.__spinwardCity.group.localToWorld(p)).toArray()
  }, point)
  const aim = async point => {
    const target = await trackingPoint(point)
    await xr.setHeadPose({ position: [0, 1.6, 0], quaternion: new Quaternion().setFromRotationMatrix(
      new Matrix4().lookAt(new Vector3(0, 1.6, 0), new Vector3(...target), new Vector3(0, 1, 0))).toArray() })
  }
  const capture = async name => captures.push(await xr.screenshot(info.outputPath(name + '.png'), { canvas: 'canvas', metadata: true, timeout: 5000 }))
  try {
    await page.getByRole('button', { name: 'Menu', exact: true }).click(); await xr.enterVR()
    const diagnostic = await xr.diagnostics()
    expect(diagnostic.runtime.playwrightWebxrVersion).toBe('0.3.0')
    expect(diagnostic.rendering.views.map(v => v.viewport.width)).toEqual([1280, 1280])
    await xr.setControllerPose('left', { position: [-.4, .6, -.2], quaternion: [0, 0, 0, 1] })
    await page.waitForFunction(() => window.__spinwardRail.rail.service.trains[0].doorOpen > .95)
    const train = await page.evaluate(() => window.__spinwardRail.rail.service.trains[0].position)
    const target = [train[0], train[1], train[2] + 1.8], right = [.22, 1.3, -.2]
    await aim(target)
    await xr.setControllerPose('right', { position: right, quaternion: aimQuaternion(right, await trackingPoint(target)) })
    await expect.poll(() => page.evaluate(() => window.__spinward.rail.pointed)).toBe(true)
    await capture('platform-open-door')
    await xr.pressButton('right', 'trigger')
    await expect.poll(() => page.evaluate(() => window.__spinward.rail.rider)).toBe('rail-a:0')
    await sample(); await capture('aboard')
    await page.waitForFunction(() => window.__spinward.rail.speed > 3, null, { timeout: 60000 })
    await xr.pressButton('right', 'a-button')
    await xr.setAxes('left', 0, -.8); await xr.settle(1200); await xr.setAxes('left', 0, 0)
    const moving = await sample(); expect(moving.rail.rider).toBe('rail-a:0'); expect(moving.rail.doors).toBe(0)
    await capture('moving')
    const next = moving.train.next
    for (let i = 0; i < 110; i++) {
      await xr.settle(3000)
      const s = await sample()
      if (i === 12 || i === 35) await capture('journey-' + i)
      if (s.rail.station === next && s.rail.doors > .95) break
    }
    const arrived = await sample()
    expect(arrived.rail.station).toBe(next); expect(arrived.rail.doors).toBeGreaterThan(.95)
    expect(Math.abs(arrived.axial - start[1])).toBeGreaterThan(5000)
    await capture('arrival')
    await xr.pressButton('right', 'a-button')
    await expect.poll(() => page.evaluate(() => window.__spinward.rail.rider)).toBeNull()
    const destination = stations.find(s => s.id === next), at = destination.boarding[0]
    const walkTarget = destination.approach.at(-2)
    for (let i = 0; i < 40; i++) {
      const s = await sample(), remaining = Math.hypot(s.azimuth * 3200 - walkTarget[0], s.axial - walkTarget[1])
      if (remaining < .65) break
      await aim([walkTarget[0], walkTarget[1], walkTarget[2] + 1.6])
      await xr.setAxes('left', 0, -Math.min(.7, Math.max(.2, remaining / 6))); await xr.settle(200)
    }
    await xr.setAxes('left', 0, 0); const walked = await sample()
    expect(walked.room.sensor).toBe(false); expect(walked.mode).toBe('grounded')
    expect(Math.hypot(walked.azimuth * 3200 - at[0], walked.axial - at[1])).toBeGreaterThan(6)
    await capture('alighted-and-walked')
    const leftQ = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2))
    await xr.setHeadPose({ position: [0, 1.6, 0], euler: [-.22, 0, 0] })
    await xr.setControllerPose('left', { position: [-.1, 1.42, -.4], quaternion: leftQ.toArray() })
    await xr.waitForFrames(3, { timeout: 5000 })
    for (const id of ['nav-places', 'nav-places-more', 'visit-station']) {
      const p = await page.evaluate(id => {
        const w = window.__spinwardWatch, l = w.layouts[w.screen], b = l.buttons.find(b => b.id === id)
        if (!b) throw Error('Missing wrist action ' + id)
        const camera = window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera', true)[0]
        return { u: (b.x + b.width / 2) / l.width, v: 1 - (b.y + b.height / 2) / l.height,
          panel: w.interactiveObject.matrixWorld.elements, rig: camera.parent.matrixWorld.elements }
      }, id)
      const m = new Matrix4().fromArray(p.rig).invert().multiply(new Matrix4().fromArray(p.panel))
      const target = new Vector3(p.u - .5, p.v - .5, 0).applyMatrix4(m).toArray()
      await xr.setControllerPose('right', { position: right, quaternion: aimQuaternion(right, target) })
      await expect.poll(() => page.evaluate(() => window.__spinwardWatch.hoveredAction)).toBe(id)
      if (id === 'visit-station') await capture('station-in-places')
      await xr.pressButton('right', 'trigger'); await xr.waitForFrames(3, { timeout: 5000 })
    }
    const returned = await sample()
    expect(Math.hypot(returned.azimuth * 3200 - destination.entry[0], returned.axial - destination.entry[1])).toBeLessThan(.3)
    await capture('station-entrance')
    await xr.endSession({ sessionId: diagnostic.session.id, timeout: 5000 })
    expect(errors).toEqual([]); expect(failures).toEqual([])
    await fs.writeFile(info.outputPath('report.json'), JSON.stringify({ gpu, diagnostic, moving, arrived, walked, returned, captures }, null, 2))
  } finally {
    await fs.writeFile(info.outputPath('samples.json'), JSON.stringify({ samples, errors, failures }, null, 2))
  }
})
