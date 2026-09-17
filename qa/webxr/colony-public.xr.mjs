import { test, expect } from 'playwright-webxr'
import { aimQuaternion } from 'playwright-webxr/examples/aim-controller'
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Raycaster, Vector3 } from 'three'
import fs from 'node:fs/promises'
const places = JSON.parse(await fs.readFile(new URL('../../assets/blender/izma-public-spaces.json', import.meta.url), 'utf8')).places

test.use({ xrStereoEnabled: true, xrIpd: .064, viewport: { width: 2560, height: 960 } })
for (const name of ['a-river', 'b-campus', 'c-fields']) test(`public place: road, square and wrist arrival at ${name}`, async ({ page, xr }, info) => {
  const place = places.find(p => p.id === name), query = 'visit=public-' + name, night = name === 'c-fields'
  test.setTimeout(120000)
  const errors = [], failures = [], samples = [], captures = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('requestfailed', r => failures.push(r.url() + ': ' + r.failure()?.errorText))
  await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '' }))
  await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&landscape=authored&preset=izma&t=${night ? '.9' : '.42'}&${query}`)
  await page.waitForSelector('#splash', { state: 'detached' })
  await page.waitForFunction(() => window.__spinwardCity.authoredColony.group.userData.pending === 0)
  const initial = await page.evaluate(centre => {
    const gl = document.querySelector('canvas').getContext('webgl2'), d = gl.getExtension('WEBGL_debug_renderer_info'), c = window.__spinwardCity
    const positions = [], meshes = [...c.authoredColony.group.getObjectByName('colony-public-ground').children,
      ...c.authoredColony.group.getObjectByName('colony-base').children.filter(m => /-(local|arterial|walk)$/.test(m.name))]
    for (const mesh of meshes) {
      const v = mesh.geometry.attributes.position.array
      for (let i = 0; i < v.length; i += 9) {
        const da = Math.atan2(v[i + 2], v[i]) - centre[0] / 3200
        if (Math.abs(Math.atan2(Math.sin(da), Math.cos(da)) * 3200) < 150 && Math.abs(v[i + 1] - centre[1]) < 150)
          for (let j = 0; j < 9; j++) positions.push(v[i + j])
      }
    }
    return { gpu: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown', positions }
  }, place.position)
  expect(initial.gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(Float32Array.from(initial.positions), 3))
  const material = new MeshBasicMaterial({ side: DoubleSide }), floor = new Mesh(geometry, material)
  const sample = async () => { const state = await page.evaluate(() => {
    const s = window.__spinward
    return { x: s.azimuth * s.radius, y: s.axial, h: s.groundHeight, radial: s.radial, mode: s.mode, radius: s.radius,
      tiles: window.__spinwardCity.authoredColony.group.userData, activeLights: window.__spinwardCity.authoredLandscape.group.userData.activeLights }
  }); state.x += Math.round((place.position[0] - state.x) / (Math.PI * 6400)) * Math.PI * 6400; return state }
  const validate = state => {
    const out = new Vector3(Math.cos(state.x / state.radius), 0, Math.sin(state.x / state.radius))
    const origin = out.clone().multiplyScalar(state.radius - 400); origin.y = state.y
    const hit = new Raycaster(origin, out, 0, 401).intersectObject(floor)[0]
    expect(hit, 'visible ground exists below the live body').toBeDefined()
    const drawnHeight = state.radius - Math.hypot(hit.point.x, hit.point.z)
    expect(state.radius - state.radial - drawnHeight, 'body cannot walk under the visible ground').toBeGreaterThan(-.12)
    expect(Math.abs(state.h - drawnHeight), 'ground sampler follows the rendered triangles').toBeLessThan(.25)
    expect(state.mode).toBe('grounded')
    expect(state.tiles.loaded).toBeLessThanOrEqual(18); expect(state.tiles.pending).toBeLessThanOrEqual(3)
    expect(state.tiles.collisionCache.entries).toBeLessThanOrEqual(128)
    expect(state.tiles.collisionCache.bytes).toBeLessThanOrEqual(4 * 1024 * 1024)
    expect(state.tiles.failed).toEqual([])
    expect(state.activeLights).toBeLessThanOrEqual(6)
    if (night) expect(state.activeLights).toBeGreaterThan(0); else expect(state.activeLights).toBe(0)
    return { ...state, drawnHeight }
  }
  const aim = async point => {
    const tracking = await page.evaluate(([x, y, h]) => {
      const c = window.__spinwardCity, r = window.__spinward.radius
      const camera = window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera', true)[0]
      const p = camera.position.clone().set(Math.cos(x / r) * (r - h - 1.6), y, Math.sin(x / r) * (r - h - 1.6))
      return camera.parent.worldToLocal(c.group.localToWorld(p)).toArray()
    }, point)
    const q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0, 1.6, 0), new Vector3(...tracking), new Vector3(0, 1, 0)))
    await xr.setHeadPose({ position: [0, 1.6, 0], quaternion: q.toArray() })
  }
  const capture = async label => captures.push(await xr.screenshot(info.outputPath(label + '.png'), { canvas: 'canvas', metadata: true, timeout: 5000 }))
  try {
    await page.getByRole('button', { name: 'Menu', exact: true }).click(); await xr.enterVR()
    const diagnostic = await xr.diagnostics()
    expect(diagnostic.runtime.playwrightWebxrVersion).toBe('0.3.0')
    expect(diagnostic.rendering.views.map(v => v.viewport.width)).toEqual([1280, 1280])
    await xr.setControllerPose('left', { position: [-.4, .6, -.2], quaternion: [0, 0, 0, 1] })
    const initialState = await sample(); samples.push(initialState)
    const start = validate(initialState), target = place.target
    await aim(target); await capture('start')
    const walkTo = async target => {
      let arrived = false
      for (let i = 0; i < 200; i++) {
        const state = validate(await sample()); samples.push(state)
        const remaining = Math.hypot(target[0] - state.x, target[1] - state.y)
        if (remaining < .65) { arrived = true; break }
        await aim(target); await xr.setAxes('left', 0, -Math.min(.8, Math.max(.18, remaining / 5))); await xr.settle(200)
      }
      await xr.setAxes('left', 0, 0); await xr.settle(300)
      expect(arrived, 'reach the destination through stick input').toBe(true)
    }
    await walkTo(target)
    const end = validate(await sample()); samples.push(end)
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeGreaterThan(Math.hypot(target[0] - start.x, target[1] - start.y) - 1.2)
    await capture('end')
    // Enter the shelter's clear front aisle, stopping before the table. This
    // checks actual head clearance, not merely a view of a roof from outside.
    const shelterTarget = [place.shelter[0] + Math.sin(place.yaw) * 1.4,
      place.shelter[1] - Math.cos(place.yaw) * 1.4, place.shelter[2]]
    await walkTo(shelterTarget)
    const sheltered = validate(await sample()); samples.push(sheltered)
    expect(sheltered.h).toBeLessThan(place.shelter[2] + .2)
    expect(place.shelter[2] + 3.05 - sheltered.h).toBeGreaterThan(2.8)
    await aim([place.shelter[0], place.shelter[1], place.shelter[2]])
    await capture('under-roof')
    {
      // The shared Places menu resolves the nearby square from the live location.
      const leftQ = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2)
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2))
      await xr.setHeadPose({ position: [0, 1.6, 0], euler: [-.22, 0, 0] })
      await xr.setControllerPose('left', { position: [-.1, 1.42, -.4], quaternion: leftQ.toArray() })
      await xr.waitForFrames(3, { timeout: 5000 })
      for (const id of ['nav-places', 'visit-public']) {
        const p = await page.evaluate(id => {
          const w = window.__spinwardWatch, l = w.layouts[w.screen], b = l.buttons.find(b => b.id === id)
          const c = window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera', true)[0]
          return { u: (b.x + b.width / 2) / l.width, v: 1 - (b.y + b.height / 2) / l.height,
            panel: w.interactiveObject.matrixWorld.elements, rig: c.parent.matrixWorld.elements }
        }, id)
        const frame = new Matrix4().fromArray(p.rig).invert().multiply(new Matrix4().fromArray(p.panel))
        const target = new Vector3(p.u - .5, p.v - .5, 0).applyMatrix4(frame).toArray(), right = [.22, 1.38, -.2]
        await xr.setControllerPose('right', { position: right, quaternion: aimQuaternion(right, target) })
        await xr.waitForFrames(2, { timeout: 5000 })
        await expect.poll(() => page.evaluate(() => window.__spinwardWatch.hoveredAction)).toBe(id)
        if (id === 'visit-public') await capture('places-menu')
        await xr.pressButton('right', 'trigger'); await xr.waitForFrames(3, { timeout: 5000 })
      }
      const returned = validate(await sample()); expect(Math.hypot(returned.x - place.entry[0], returned.y - place.entry[1])).toBeLessThan(.2)
      await capture('returned-square'); samples.push(returned)
    }
    await xr.endSession({ sessionId: diagnostic.session.id, timeout: 5000 })
    expect(await xr.sessionMode()).toBeNull(); expect(errors).toEqual([]); expect(failures).toEqual([])
    await fs.writeFile(info.outputPath('report.json'), JSON.stringify({ gpu: initial.gpu, diagnostic, start, end, sheltered, samples, captures, errors, failures }, null, 2))
  } finally {
    geometry.dispose(); material.dispose()
    await fs.writeFile(info.outputPath('samples.json'), JSON.stringify({ samples, errors, failures }, null, 2))
  }
})
