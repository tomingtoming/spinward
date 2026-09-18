import { test, expect } from 'playwright-webxr'
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Raycaster, Vector3 } from 'three'
import fs from 'node:fs/promises'

const { parcels } = JSON.parse(await fs.readFile(new URL('../../assets/blender/izma-neighbourhood-parcels.json', import.meta.url), 'utf8'))
const examples = ['a-river', 'b-housing', 'c-market'].flatMap(id => [
  parcels.find(p => p.district === id && p.family === 'shop-house'),
  parcels.find(p => p.district === id && p.lot.placement === 'frontage-gap')
])
test.use({ xrStereoEnabled: true, xrIpd: .064, viewport: { width: 2560, height: 960 } })
for (const parcel of examples) test(`${parcel.lot.placement === 'frontage-gap' ? 'small frontage infill' : 'new neighbourhood'}: ${parcel.district} street to door and back`, async ({ page, xr }, info) => {
  const errors = [], failures = [], samples = [], captures = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('requestfailed', r => { if (!r.failure()?.errorText.includes('ERR_ABORTED')) failures.push(r.url() + ': ' + r.failure()?.errorText) })
  await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '' }))
  const startPoint = parcel.access.start.map((v, i) => v + (parcel.access.end[i] - v) * .4 / parcel.access.length)
  await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&landscape=authored&preset=izma&t=${parcel.band === 2 ? .9 : .42}&m=g&a=${startPoint[0] / 3200}&ax=${startPoint[1]}&gh=${startPoint[2]}`)
  await page.waitForSelector('#splash', { state: 'detached' })
  await page.waitForFunction(() => window.__spinwardCity.authoredColony.group.userData.pending === 0)
  const drawing = await page.evaluate(centre => {
    const colony = window.__spinwardCity.authoredColony.group
    const gl = document.querySelector('canvas').getContext('webgl2'), d = gl.getExtension('WEBGL_debug_renderer_info')
    const positions = []
    // The return can step a few centimetres beyond the approach onto its
    // connected street. Validate the actual rendered road there as well.
    for (const mesh of [...colony.getObjectByName('colony-base').children,
      ...colony.getObjectByName('colony-neighbourhood-ground').children]) {
      const v = mesh.geometry.attributes.position.array
      for (let i = 0; i < v.length; i += 9) {
        const a = Math.atan2(v[i + 2], v[i]), dx = Math.atan2(Math.sin(a - centre[0] / 3200), Math.cos(a - centre[0] / 3200)) * 3200
        if (Math.abs(dx) < 60 && Math.abs(v[i + 1] - centre[1]) < 60) for (let j = 0; j < 9; j++) positions.push(v[i + j])
      }
    }
    return { positions, gpu: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown' }
  }, parcel.position)
  expect(drawing.gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  expect(drawing.positions.length).toBeGreaterThan(9)
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(Float32Array.from(drawing.positions), 3))
  const material = new MeshBasicMaterial({ side: DoubleSide }), floor = new Mesh(geometry, material)
  const sample = async () => {
    const s = await page.evaluate(() => {
      const s = window.__spinward, c = window.__spinwardCity.authoredColony.group.userData
      return { x: s.azimuth * s.radius, y: s.axial, h: s.groundHeight, radial: s.radial, mode: s.mode, colony: c,
        activeLights: window.__spinwardCity.authoredLandscape.group.userData.activeLights }
    })
    s.x += Math.round((parcel.position[0] - s.x) / (Math.PI * 6400)) * Math.PI * 6400
    const outward = new Vector3(Math.cos(s.x / 3200), 0, Math.sin(s.x / 3200))
    const origin = outward.clone().multiplyScalar(3200 - s.h - .25); origin.y = s.y
    const hit = new Raycaster(origin, outward, 0, 1).intersectObject(floor)[0]
    expect(hit, 'live body is supported by the rendered approach or connected street').toBeDefined()
    const h = 3200 - Math.hypot(hit.point.x, hit.point.z)
    expect(Math.abs(s.h - h)).toBeLessThan(.18)
    expect(3200 - s.radial - h).toBeGreaterThan(-.12)
    expect(s.mode).toBe('grounded'); expect(s.colony.neighbourhoodBuildings).toBe(parcels.length)
    expect(s.colony.loaded).toBeLessThanOrEqual(18); expect(s.colony.pending).toBeLessThanOrEqual(3)
    expect(s.colony.failed).toEqual([])
    expect(s.colony.collisionCache.entries).toBeLessThanOrEqual(128)
    expect(s.colony.collisionCache.bytes).toBeLessThanOrEqual(4 * 1024 * 1024)
    expect(s.activeLights).toBeLessThanOrEqual(6)
    if (parcel.band === 2) expect(s.activeLights).toBeGreaterThan(0)
    samples.push({ ...s, drawnHeight: h }); return s
  }
  const aim = async at => {
    const tracking = await page.evaluate(([x, y, h]) => {
      const c = window.__spinwardCity, camera = window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera', true)[0]
      const p = camera.position.clone().set(Math.cos(x / 3200) * (3200 - h - 1.6), y, Math.sin(x / 3200) * (3200 - h - 1.6))
      return camera.parent.worldToLocal(c.group.localToWorld(p)).toArray()
    }, at)
    const q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0, 1.6, 0), new Vector3(...tracking), new Vector3(0, 1, 0)))
    await xr.setHeadPose({ position: [0, 1.6, 0], quaternion: q.toArray() })
  }
  const capture = async label => captures.push(await xr.screenshot(info.outputPath(label + '.png'), { canvas: 'canvas', metadata: true, timeout: 5000 }))
  const walk = async target => {
    let arrived = false
    for (let i = 0; i < 100; i++) {
      const s = await sample(), remaining = Math.hypot(s.x - target[0], s.y - target[1])
      if (remaining < .65) { arrived = true; break }
      await aim(target); await xr.setAxes('left', 0, -Math.min(.65, Math.max(.2, remaining / 6))); await xr.settle(200)
      await xr.setAxes('left', 0, 0)
    }
    await xr.setAxes('left', 0, 0); await xr.settle(200)
    expect(arrived, 'reach the target with continuous stick locomotion').toBe(true)
    return sample()
  }
  try {
    await page.getByRole('button', { name: 'Menu', exact: true }).click(); await xr.enterVR()
    const diagnostic = await xr.diagnostics()
    expect(diagnostic.runtime.playwrightWebxrVersion).toBe('0.3.0')
    expect(diagnostic.rendering.views.map(v => v.viewport.width)).toEqual([1280, 1280])
    await xr.setControllerPose('left', { position: [-.4, .6, -.2], quaternion: [0, 0, 0, 1] })
    const start = await sample(); await aim(parcel.access.end); await capture('street')
    const end = await walk(parcel.access.end)
    expect(Math.abs(end.h - parcel.floor)).toBeLessThan(.3)
    await aim(startPoint); await capture('door-looking-out')
    const returned = await walk(startPoint); await capture('returned')
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeGreaterThan(parcel.access.length - 1.5)
    await xr.endSession({ sessionId: diagnostic.session.id, timeout: 5000 })
    expect(errors).toEqual([]); expect(failures).toEqual([])
    await fs.writeFile(info.outputPath('report.json'), JSON.stringify({ parcel: parcel.id, diagnostic, start, end, returned, captures }, null, 2))
  } finally {
    geometry.dispose(); material.dispose()
    await fs.writeFile(info.outputPath('samples.json'), JSON.stringify({ parcel: parcel.id, samples, errors, failures }, null, 2))
  }
})
