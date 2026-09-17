import { test, expect } from 'playwright-webxr'
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Raycaster, Vector3 } from 'three'
import fs from 'node:fs/promises'

const transport = JSON.parse(await fs.readFile(new URL('../../assets/blender/izma-transport.json', import.meta.url), 'utf8'))
const plan = JSON.parse(await fs.readFile(new URL('../../assets/blender/izma-colony-plan.json', import.meta.url), 'utf8'))
test.use({ xrStereoEnabled: true, xrIpd: .064, viewport: { width: 2560, height: 960 } })

for (const band of [0, 1, 2]) test(`colony transport: walk and stop at the motorway parapet on strip ${band}`, async ({ page, xr }, info) => {
  const errors = [], failures = [], samples = [], captures = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('requestfailed', r => failures.push(r.url() + ': ' + r.failure()?.errorText))
  await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '' }))
  const route = transport.profiles.find(p => p.id === `band-${band}-expressway`)
  const i = Math.floor(route.points.length * .37), p = route.points[i], next = route.points[i + 1]
  const shift = band * Math.PI * 6400 / 3, width = plan.routes.find(r => r.id === route.id).width
  const dx = next[0] - p[0], dy = next[1] - p[1], length = Math.hypot(dx, dy)
  const normal = [-dy / length, dx / length]
  await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&landscape=authored&preset=izma&t=.42&m=g&a=${(p[0] + shift) / 3200}&ax=${p[1]}&gh=${p[2]}`)
  await page.waitForSelector('#splash', { state: 'detached' })
  const initial = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2'), d = gl.getExtension('WEBGL_debug_renderer_info')
    return { gpu: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown',
      positions: Array.from(window.__spinwardCity.authoredColony.group.getObjectByName('colony-base-expressway').geometry.attributes.position.array) }
  })
  expect(initial.gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(Float32Array.from(initial.positions), 3))
  const material = new MeshBasicMaterial({ side: DoubleSide }), floor = new Mesh(geometry, material)
  const sample = async () => {
    const state = await page.evaluate(() => {
      const s = window.__spinward, c = window.__spinwardCity
      return { x: s.azimuth * s.radius, y: s.axial, h: s.groundHeight, radial: s.radial, mode: s.mode, radius: s.radius,
        tiles: c.authoredColony.group.userData }
    })
    state.x += Math.round((p[0] + shift - state.x) / (Math.PI * 6400)) * Math.PI * 6400
    const a = state.x / state.radius, out = new Vector3(Math.cos(a), 0, Math.sin(a))
    const origin = out.clone().multiplyScalar(state.radius - 400); origin.y = state.y
    const hit = new Raycaster(origin, out, 0, 401).intersectObject(floor)[0]
    expect(hit, 'live body stays above the drawn motorway deck').toBeDefined()
    const drawnHeight = state.radius - Math.hypot(hit.point.x, hit.point.z)
    expect(Math.abs(state.h - drawnHeight)).toBeLessThan(.25)
    expect(state.radius - state.radial - drawnHeight).toBeGreaterThan(-.12)
    expect(state.mode).toBe('grounded')
    expect(state.tiles.loaded).toBeLessThanOrEqual(18); expect(state.tiles.pending).toBeLessThanOrEqual(3)
    expect(state.tiles.failed).toEqual([])
    const result = { ...state, drawnHeight }; samples.push(result); return result
  }
  const aim = async point => {
    const tracking = await page.evaluate(([x, y, h]) => {
      const r = window.__spinward.radius, c = window.__spinwardCity
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
    const start = await sample(), target = [next[0] + shift, next[1], next[2]]
    await aim(target); await capture('start')
    let arrived = false
    for (let n = 0; n < 180; n++) {
      const state = await sample(), remaining = Math.hypot(state.x - target[0], state.y - target[1])
      if (remaining < .8) { arrived = true; break }
      await aim(target); await xr.setAxes('left', 0, -Math.min(.8, Math.max(.18, remaining / 5))); await xr.settle(200)
    }
    await xr.setAxes('left', 0, 0); await xr.settle(200)
    expect(arrived, 'walk one deck segment with real stick input').toBe(true)
    const walked = await sample(), distance = Math.hypot(walked.x - start.x, walked.y - start.y)
    expect(distance).toBeGreaterThan(length - 1.2)
    await capture('walked')
    const outside = [walked.x + normal[0] * (width + 5), walked.y + normal[1] * (width + 5), walked.h]
    let previous, still = 0, blocked = false
    for (let n = 0; n < 100; n++) {
      await aim(outside); await xr.setAxes('left', 0, -.8); await xr.settle(200)
      const state = await sample(), lateral = (state.x - (p[0] + shift)) * normal[0] + (state.y - p[1]) * normal[1]
      expect(lateral, 'body cannot cross the parapet').toBeLessThan(width / 2 + .1)
      if (previous && Math.hypot(state.x - previous.x, state.y - previous.y) < .03) still++; else still = 0
      if (lateral > width / 2 - 1.6 && still >= 6) { blocked = true; break }
      previous = state
    }
    await xr.setAxes('left', 0, 0); await xr.settle(200)
    expect(blocked, 'sustained input stops against the physical parapet').toBe(true)
    const end = await sample(); await capture('blocked')
    await xr.endSession({ sessionId: diagnostic.session.id, timeout: 5000 })
    expect(await xr.sessionMode()).toBeNull(); expect(errors).toEqual([]); expect(failures).toEqual([])
    await fs.writeFile(info.outputPath('report.json'), JSON.stringify({ gpu: initial.gpu, diagnostic, start, walked, end, distance, width, samples, captures, errors, failures }, null, 2))
  } finally {
    geometry.dispose(); material.dispose()
    await fs.writeFile(info.outputPath('samples.json'), JSON.stringify({ samples, errors, failures }, null, 2))
  }
})
