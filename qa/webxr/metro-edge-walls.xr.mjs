import { test, expect } from 'playwright-webxr'
import { Matrix4, Quaternion, Vector3 } from 'three'
import fs from 'node:fs/promises'

// The retaining wall's parapet stops a walker at the window-side edge of the
// Tokyo terrain, and the wall closes the view under the terrain sheet.
test.use({ xrStereoEnabled: true, viewport: { width: 2560, height: 960 } })
test('Tokyo edge wall: a VR walker stops at the parapet above the window', async ({ page, xr }, info) => {
  test.setTimeout(240000)
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '' }))
  const R = 3200, band = 2, y = 19300, edge = -1675.516, start = -1650
  const colony = (x, h) => [-(band * Math.PI * 2 / 3 * R + x), -y, h]
  await page.goto(`/?city=tokyo&preset=izma&debug&metrics=off&lock=0&dpr=1&tier=quest&t=.42&m=g&a=${colony(start, 0)[0] / R}&ax=${-y}&gh=33.5`)
  await page.waitForFunction(() => window.__spinward?.metro?.ready && window.__spinward.regional.state === 'ready' &&
    !window.__spinward.regional.pendingArrival && !document.querySelector('#splash') && window.__spinwardMetro.structuresReady === true, null, { timeout: 180000 })
  const source = () => page.evaluate(([band, R]) => {
    const s = window.__spinward
    return { x: -(s.azimuth * R) - band * Math.PI * 2 / 3 * R, groundHeight: s.groundHeight, mode: s.mode }
  }, [band, R]).then(s => ({ ...s, x: ((s.x + Math.PI * R) % (2 * Math.PI * R) + 2 * Math.PI * R) % (2 * Math.PI * R) - Math.PI * R }))
  const tp = pt => page.evaluate(([cx, ax, h]) => { const c = window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera', true)[0]
    const q = c.position.clone().set(Math.cos(cx / 3200) * (3200 - h), ax, Math.sin(cx / 3200) * (3200 - h)); return c.parent.worldToLocal(window.__spinwardCity.group.localToWorld(q)).toArray() }, pt)
  await page.getByRole('button', { name: 'Menu', exact: true }).click(); await xr.enterVR(); await xr.settle(2000)
  const before = await source()
  expect(before.mode).toBe('grounded'); expect(Math.abs(before.x - start)).toBeLessThan(1)
  // Face the window and hold the stick forward well past the edge distance.
  const target = await tp(colony(edge - 200, 30))
  await xr.setHeadPose({ position: [0, 1.6, 0], quaternion: new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0, 1.6, 0), new Vector3(...target), new Vector3(0, 1, 0))).toArray() })
  await xr.setAxes('left', 0, -1); await xr.settle(8000); await xr.setAxes('left', 0, 0); await xr.settle(800)
  const after = await source()
  await xr.screenshot(info.outputPath('at-parapet.png'), { canvas: 'canvas', timeout: 5000 })
  // Walking speed would carry ~48 m; the body must stop inside the parapet.
  expect(after.mode).toBe('grounded')
  expect(after.x).toBeGreaterThan(edge + .2)
  expect(after.x).toBeLessThan(start - 15)
  expect(after.groundHeight).toBeGreaterThan(20)
  await xr.endSession()
  expect(errors).toEqual([])
  await fs.writeFile(info.outputPath('walk.json'), JSON.stringify({ before, after }, null, 2))
  console.log('EDGEWALK', JSON.stringify({ before, after }))
})
