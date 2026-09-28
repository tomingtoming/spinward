import { test, expect } from 'playwright-webxr'
import { aimQuaternion } from 'playwright-webxr/examples/aim-controller'
import { Matrix4, Quaternion, Vector3 } from 'three'
import fs from 'node:fs/promises'

// Tokyo street tram: stand on the Oji-ekimae island, board in VR, ride in real
// time to the next stop and step off onto its island. Only the service clock
// is advanced before boarding so that a car stops on the tested side.
test.use({ xrStereoEnabled: true, xrIpd: .064, viewport: { width: 2560, height: 960 } })
test('Tokyo tram: board at Oji-ekimae, ride to the next stop and alight', async ({ page, xr }, info) => {
  test.setTimeout(420000)
  const errors = [], samples = [], captures = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '' }))
  const ready = async () => {
    await page.waitForFunction(() => window.__spinward?.metro?.ready && window.__spinward.regional.state === 'ready' &&
      !window.__spinward.regional.pendingArrival && !document.querySelector('#splash'), null, { timeout: 180000 })
  }
  await page.goto('/?city=tokyo&preset=izma&debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42&place=oji')
  await ready()
  const plan = await page.evaluate(() => {
    const data = window.__spinwardRail.rail.service?.data
    return data && { stations: data.stations.map(s => ({ id: s.id, name: s.name, s: s.s, platform: s.platform, boarding: s.boarding })),
      line: data.lines[0].name, config: data.configuration }
  })
  expect(plan, 'Tokyo mode configures the tram service').toBeTruthy()
  expect(plan.line).toBe('都電荒川線')
  const station = plan.stations.find(s => s.name === '王子駅前'), stand = station.boarding[0]
  await page.goto(`/?city=tokyo&preset=izma&debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42&m=g&a=${stand[0] / 3200}&ax=${stand[1]}&gh=${stand[2]}`)
  await ready()
  const gpu = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2'), d = gl.getExtension('WEBGL_debug_renderer_info')
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'
  })
  expect(gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  const sample = async () => {
    const s = await page.evaluate(() => {
      const s = window.__spinward, t = window.__spinwardRail.ride.train
      return { azimuth: s.azimuth, axial: s.axial, groundHeight: s.groundHeight, mode: s.mode, rail: s.rail,
        train: t && { id: t.id, station: t.station?.id ?? null, next: t.next.id, lane: t.lane } }
    })
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
    const diagnostic = await xr.diagnostics(); expect(diagnostic.runtime.playwrightWebxrVersion).toBe('0.3.0')
    await xr.setControllerPose('left', { position: [-.4, .6, -.2], quaternion: [0, 0, 0, 1] })
    await xr.settle(600)
    const standing = await sample()
    expect(standing.mode).toBe('grounded')
    expect(Math.hypot(standing.azimuth * 3200 - stand[0], standing.axial - stand[1])).toBeLessThan(.5)
    const islandStep = standing.groundHeight - station.platform[2]
    expect(Math.abs(islandStep), 'source street surface under the island matches the stop height').toBeLessThan(.2)
    await aim([stand[0], stand[1] - 20, stand[2] + 1.2]); await capture('island-before-arrival')
    // Advance only the timetable until a car on this side has its doors open here.
    const id = await page.evaluate(stationId => {
      const service = window.__spinwardRail.rail.service
      for (let i = 0; i < 4000; i++) {
        const train = service.trains.find(t => t.station?.id === stationId && t.lane < 0 && t.doorOpen > .95 && t.departureIn > 14)
        if (train) return train.id
        service.step(1)
      }
      return null
    }, station.id)
    expect(id).toBeTruthy()
    await xr.settle(300)
    const train = await page.evaluate(id => window.__spinwardRail.rail.service.trains.find(t => t.id === id).position, id)
    const target = [train[0], train[1], train[2] + 1.8], right = [.22, 1.3, -.2]
    await aim(target)
    await xr.setControllerPose('right', { position: right, quaternion: aimQuaternion(right, await trackingPoint(target)) })
    await expect.poll(() => page.evaluate(() => window.__spinward.rail.pointed)).toBe(true)
    await capture('open-door')
    await xr.pressButton('right', 'trigger')
    await expect.poll(() => page.evaluate(() => window.__spinward.rail.rider)).toBe(id)
    const aboard = await sample(); await capture('aboard')
    const next = aboard.train.next
    await page.waitForFunction(() => window.__spinward.rail.speed > 3, null, { timeout: 60000 })
    await capture('moving')
    let arrived = null
    for (let i = 0; i < 60; i++) {
      await xr.settle(3000)
      const s = await sample()
      expect(s.rail.rider).toBe(id)
      if (s.train.station === next && s.rail.doors > .95) { arrived = s; break }
    }
    expect(arrived, 'the car reaches the next stop in real time').toBeTruthy()
    await capture('arrival')
    await xr.pressButton('right', 'a-button')
    await expect.poll(() => page.evaluate(() => window.__spinward.rail.rider)).toBeNull()
    await xr.settle(600)
    const off = await sample(), destination = plan.stations.find(s => s.id === next), door = destination.boarding[0]
    expect(off.mode).toBe('grounded')
    expect(Math.hypot(off.azimuth * 3200 - door[0], off.axial - door[1])).toBeLessThan(.5)
    expect(Math.abs(off.groundHeight - destination.platform[2])).toBeLessThan(.2)
    await aim([door[0], door[1] + 25, door[2] + 1.2]); await capture('alighted')
    await xr.endSession({ sessionId: diagnostic.session.id, timeout: 5000 })
    expect(errors).toEqual([])
    await fs.writeFile(info.outputPath('report.json'), JSON.stringify({ gpu, station: station.name,
      next: destination.name, islandStep, standing, aboard, arrived, off, captures }, null, 2))
  } finally {
    await fs.writeFile(info.outputPath('samples.json'), JSON.stringify({ samples, errors }, null, 2))
  }
})

// Boarding requires the walker's street surface within 0.2 m of each stop.
// Stop heights come from the offline terrain grid; measure the live ground.
test('Tokyo tram: every stop island lies on the walkable street surface', async ({ page }, info) => {
  test.setTimeout(900000)
  await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '' }))
  const ready = () => page.waitForFunction(() => window.__spinward?.metro?.ready && window.__spinward.regional.state === 'ready' &&
    !window.__spinward.regional.pendingArrival && !document.querySelector('#splash'), null, { timeout: 180000 })
  await page.goto('/?city=tokyo&preset=izma&debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42&place=oji'); await ready()
  const stations = await page.evaluate(() => window.__spinwardRail.rail.service.data.stations.map(s => ({ name: s.name, platform: s.platform, boarding: s.boarding })))
  const rows = []
  for (const station of stations) for (const side of [0, 1]) {
    const p = station.boarding[side]
    await page.goto(`/?city=tokyo&preset=izma&debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42&m=g&a=${p[0] / 3200}&ax=${p[1]}&gh=${p[2]}`); await ready()
    await page.waitForTimeout(1500)
    const s = await page.evaluate(() => ({ azimuth: window.__spinward.azimuth, axial: window.__spinward.axial, groundHeight: window.__spinward.groundHeight, mode: window.__spinward.mode }))
    rows.push({ name: station.name, side, step: s.groundHeight - station.platform[2], moved: Math.hypot(s.azimuth * 3200 - p[0], s.axial - p[1]), mode: s.mode })
  }
  await fs.writeFile(info.outputPath('islands.json'), JSON.stringify(rows, null, 2))
  console.log('ISLANDS', JSON.stringify(rows.map(r => [r.name, r.side, +r.step.toFixed(3), +r.moved.toFixed(2), r.mode])))
  for (const r of rows) {
    expect(r.mode, r.name).toBe('grounded')
    expect(r.moved, r.name).toBeLessThan(.5)
    expect(Math.abs(r.step), `${r.name} side ${r.side}`).toBeLessThan(.2)
  }
})
