import { test, expect } from 'playwright-webxr'
import { aimQuaternion } from 'playwright-webxr/examples/aim-controller'
import { Matrix4, Quaternion, Vector3 } from 'three'
import fs from 'node:fs/promises'

// Window viaducts: walk along the tram street onto the Arakawa viaduct, and
// ride the Arakawa tram from Otsuka-ekimae across the window to Mukohara.
test.use({ xrStereoEnabled: true, xrIpd: .064, viewport: { width: 2560, height: 960 } })
const R = 3200
const ready = page => page.waitForFunction(() => window.__spinward?.metro?.ready && window.__spinward.regional.state === 'ready' &&
  !window.__spinward.regional.pendingArrival && !document.querySelector('#splash') && window.__spinwardMetro.structuresReady === true, null, { timeout: 180000 })
const eastX = s => -(s.azimuth * R) // east strip (band 0) source x, extended over its window
const tracking = (page, [cx, ax, h]) => page.evaluate(([cx, ax, h]) => { const c = window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera', true)[0]
  const q = c.position.clone().set(Math.cos(cx / 3200) * (3200 - h), ax, Math.sin(cx / 3200) * (3200 - h)); return c.parent.worldToLocal(window.__spinwardCity.group.localToWorld(q)).toArray() }, [cx, ax, h])
const look = async (page, xr, point) => {
  const target = await tracking(page, point)
  await xr.setHeadPose({ position: [0, 1.6, 0], quaternion: new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0, 1.6, 0), new Vector3(...target), new Vector3(0, 1, 0))).toArray() })
}
const state = page => page.evaluate(() => ({ azimuth: window.__spinward.azimuth, axial: window.__spinward.axial, groundHeight: window.__spinward.groundHeight, mode: window.__spinward.mode, rail: window.__spinward.rail }))

test('walk from the east strip along the tram street onto the Arakawa viaduct', async ({ page, xr }, info) => {
  test.setTimeout(240000)
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '' }))
  const y = 11933.105, start = 1640
  await page.goto(`/?city=tokyo&preset=izma&debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42&m=g&a=${-start / R}&ax=${-y}&gh=20.1`)
  await ready(page)
  await page.getByRole('button', { name: 'Menu', exact: true }).click(); await xr.enterVR(); await xr.settle(2000)
  const before = await state(page)
  expect(before.mode).toBe('grounded'); expect(Math.abs(eastX(before) - start)).toBeLessThan(1)
  await look(page, xr, [-(start + 400), -y, 21.5])
  await xr.setAxes('left', 0, -1); await xr.settle(9000); await xr.setAxes('left', 0, 0); await xr.settle(800)
  const after = await state(page)
  await xr.screenshot(info.outputPath('on-viaduct.png'), { canvas: 'canvas', timeout: 5000 })
  console.log('VIADUCT-WALK', JSON.stringify({ before, after, x: eastX(after), y: -after.axial }))
  // ~54 m of walking: past the 1675.5 m edge, grounded on the deck at its height.
  expect(after.mode).toBe('grounded')
  expect(eastX(after)).toBeGreaterThan(1675.5 + 15)
  expect(Math.abs(after.groundHeight - 20.13)).toBeLessThan(.2)
  expect(Math.abs(after.axial + y)).toBeLessThan(4)
  await xr.endSession(); expect(errors).toEqual([])
})

test('ride the Arakawa tram across the window from Otsuka-ekimae to Mukohara', async ({ page, xr }, info) => {
  test.setTimeout(900000)
  const errors = [], samples = []; page.on('pageerror', e => errors.push(e.message))
  await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '' }))
  await page.goto('/?city=tokyo&preset=izma&debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42&place=oji'); await ready(page)
  const stations = await page.evaluate(() => window.__spinwardRail.rail.service.data.stations.map(s => ({ id: s.id, name: s.name, platform: s.platform, boarding: s.boarding })))
  const from = stations.find(s => s.name === '大塚駅前'), to = stations.find(s => s.name === '向原')
  const stand = from.boarding[0]
  await page.goto(`/?city=tokyo&preset=izma&debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42&m=g&a=${stand[0] / R}&ax=${stand[1]}&gh=${stand[2]}`); await ready(page)
  await page.getByRole('button', { name: 'Menu', exact: true }).click(); await xr.enterVR(); await xr.settle(1500)
  await xr.setControllerPose('left', { position: [-.4, .6, -.2], quaternion: [0, 0, 0, 1] })
  // Advance only the timetable until a car toward Mukohara opens this side's doors here.
  const id = await page.evaluate(([fromId, toId]) => {
    const service = window.__spinwardRail.rail.service
    for (let i = 0; i < 8000; i++) {
      const t = service.trains.find(t => t.station?.id === fromId && t.next.id === toId && t.lane < 0 && t.doorOpen > .95 && t.departureIn > 14)
      if (t) return t.id
      service.step(1)
    }
    return null
  }, [from.id, to.id])
  expect(id).toBeTruthy(); await xr.settle(300)
  const train = await page.evaluate(id => window.__spinwardRail.rail.service.trains.find(t => t.id === id).position, id)
  const target = [train[0], train[1], train[2] + 1.8], right = [.22, 1.3, -.2]
  await look(page, xr, target)
  await xr.setControllerPose('right', { position: right, quaternion: aimQuaternion(right, await tracking(page, target)) })
  await expect.poll(() => page.evaluate(() => window.__spinward.rail.pointed)).toBe(true)
  await xr.pressButton('right', 'trigger')
  await expect.poll(() => page.evaluate(() => window.__spinward.rail.rider)).toBe(id)
  let arrived = null, overWindow = null
  for (let i = 0; i < 150; i++) {
    await xr.settle(3000)
    const s = await state(page); samples.push(s)
    expect(s.rail.rider).toBe(id)
    const x = eastX(s)
    if (!overWindow && x > 3000 && x < 3700) {
      overWindow = s
      await look(page, xr, [-(x + 300), s.axial, 30]); await xr.screenshot(info.outputPath('crossing.png'), { canvas: 'canvas', timeout: 5000 })
    }
    if (s.rail.station === to.id && s.rail.doors > .95) { arrived = s; break }
  }
  expect(overWindow, 'the ride passes over the middle of the window').toBeTruthy()
  // Carried at deck height (20.13 m) plus the car floor.
  expect(Math.abs(overWindow.groundHeight - (20.13 + .62))).toBeLessThan(.2)
  expect(arrived, 'the car reaches Mukohara in real time').toBeTruthy()
  await xr.pressButton('right', 'a-button')
  await expect.poll(() => page.evaluate(() => window.__spinward.rail.rider)).toBeNull()
  const after = []
  for (let i = 0; i < 12; i++) {
    await xr.settle(250)
    after.push(await page.evaluate(() => ({ t: performance.now(), mode: window.__spinward.mode, gh: window.__spinward.groundHeight, az: window.__spinward.azimuth, ax: window.__spinward.axial,
      regional: window.__spinward.regional?.state, collision: window.__spinwardMetro.collision?.stats && { entries: window.__spinwardMetro.collision.stats.entries, pending: window.__spinwardMetro.collision.stats.pending, missingCritical: window.__spinwardMetro.collision.stats.missingCritical, ready: window.__spinwardMetro.collision.stats.ready } })))
  }
  await fs.writeFile(info.outputPath('after.json'), JSON.stringify({ arrived, after }, null, 2))
  console.log('AFTER', JSON.stringify(after.map(a => [a.mode, +a.gh.toFixed(2), a.regional, a.collision])))
  const off = await state(page), door = to.boarding[0]
  expect(off.mode).toBe('grounded')
  expect(Math.hypot(off.azimuth * R - door[0], off.axial - door[1])).toBeLessThan(.5)
  expect(Math.abs(off.groundHeight - to.platform[2])).toBeLessThan(.2)
  await xr.endSession(); expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('ride.json'), JSON.stringify({ overWindow, arrived, off, samples }, null, 2))
  console.log('WINDOW-RIDE', JSON.stringify({ overWindow: { x: eastX(overWindow), h: overWindow.groundHeight }, off }))
})
