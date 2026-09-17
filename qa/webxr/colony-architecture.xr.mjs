import { test, expect } from 'playwright-webxr'
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Raycaster, Vector3 } from 'three'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'

const { parcels } = JSON.parse(await fs.readFile(new URL('../../assets/blender/izma-parcels.json', import.meta.url), 'utf8'))
const steepest = [...parcels].sort((a, b) => Math.abs(b.access.end[2] - b.access.start[2]) - Math.abs(a.access.end[2] - a.access.start[2]))[0]
const relocated = parcels.filter(p => p.relocatedFrom && !p.access.stairs).sort((a, b) => a.id.localeCompare(b.id))[0]
const balcony = parcels.find(p => p.family === 'apartment' && p.band === 2 && p.floors >= 4)
// Stand within an actual balcony bay, not inside the central divider panel.
const balconyBays = Math.max(2, Math.floor(balcony.size[0] / [2.8, 3.3, 3.9][createHash('sha256').update(balcony.id).digest().readUInt32BE() % 3]))
const balconyU = -balcony.size[0] * .46 + (Math.floor(balconyBays / 2) + .5) * balcony.size[0] * .92 / balconyBays
const point = (p, u, v, h) => [p.position[0] + Math.cos(p.yaw) * u - Math.sin(p.yaw) * v,
  p.position[1] + Math.sin(p.yaw) * u + Math.cos(p.yaw) * v, p.floor + h]

test.use({ xrStereoEnabled: true, xrIpd: .064, viewport: { width: 2560, height: 960 } })
for (const [kind, parcel] of [['stairs', steepest], ['relocated-entry', relocated], ['balcony', balcony]]) {
  test(`district architecture: ${kind} has drawn support and physical barriers`, async ({ page, xr }, info) => {
    const errors = [], failures = [], samples = [], captures = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('requestfailed', r => { if (!r.failure()?.errorText.includes('ERR_ABORTED')) failures.push(r.url() + ': ' + r.failure()?.errorText) })
    await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '' }))
    const startPoint = kind === 'balcony' ? point(parcel, balconyU, -parcel.size[1] * .3 - .8, 3.2) : parcel.access.start.map((n, axis) => n + (parcel.access.end[axis] - n) * .4 / parcel.access.length)
    const target = kind === 'balcony' ? point(parcel, balconyU, -parcel.size[1] * .3 - 4, 3.2) : parcel.access.end
    await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&landscape=authored&preset=izma&t=.42&m=g&a=${startPoint[0] / 3200}&ax=${startPoint[1]}&gh=${startPoint[2]}`)
    await page.waitForSelector('#splash', { state: 'detached' })
    await page.waitForFunction(() => window.__spinwardCity.authoredColony.group.userData.pending === 0)
    const drawing = await page.evaluate(({ kind, centre }) => {
      const colony = window.__spinwardCity.authoredColony.group
      const gl = document.querySelector('canvas').getContext('webgl2'), d = gl.getExtension('WEBGL_debug_renderer_info')
      const meshes = kind === 'balcony' ? colony.children.filter(g => /^colony-tile-/.test(g.name) && g.visible)
        .flatMap(g => g.children.filter(l => l.visible).flatMap(l => l.children)) : [colony.getObjectByName('colony-parcel-ground-arch-paving')]
      const positions = []
      for (const mesh of meshes) {
        const v = mesh.geometry.attributes.position.array
        for (let i = 0; i < v.length; i += 9) {
          const a = Math.atan2(v[i + 2], v[i]), tangent = Math.atan2(Math.sin(a - centre[0] / 3200), Math.cos(a - centre[0] / 3200)) * 3200
          if (Math.abs(tangent) < 65 && Math.abs(v[i + 1] - centre[1]) < 65) for (let j = 0; j < 9; j++) positions.push(v[i + j])
        }
      }
      return { positions, gpu: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown' }
    }, { kind, centre: parcel.position })
    expect(drawing.gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
    expect(drawing.positions.length).toBeGreaterThan(9)
    const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(Float32Array.from(drawing.positions), 3))
    const material = new MeshBasicMaterial({ side: DoubleSide }), floor = new Mesh(geometry, material)
    const sample = async () => {
      const state = await page.evaluate(() => {
        const s = window.__spinward
        return { x: s.azimuth * s.radius, y: s.axial, h: s.groundHeight, radial: s.radial, mode: s.mode,
          tiles: window.__spinwardCity.authoredColony.group.userData }
      })
      state.x += Math.round((parcel.position[0] - state.x) / (Math.PI * 6400)) * Math.PI * 6400
      const outward = new Vector3(Math.cos(state.x / 3200), 0, Math.sin(state.x / 3200))
      const origin = outward.clone().multiplyScalar(3200 - state.h - .25); origin.y = state.y
      const hit = new Raycaster(origin, outward, 0, 1).intersectObject(floor)[0]
      expect(hit, 'the live body has a rendered tread/ramp/balcony below it').toBeDefined()
      const drawnHeight = 3200 - Math.hypot(hit.point.x, hit.point.z)
      expect(Math.abs(state.h - drawnHeight)).toBeLessThan(.18)
      expect(3200 - state.radial - drawnHeight).toBeGreaterThan(-.12)
      expect(state.mode).toBe('grounded')
      expect(state.tiles.loaded).toBeLessThanOrEqual(18); expect(state.tiles.pending).toBeLessThanOrEqual(3)
      expect(state.tiles.failed).toEqual([])
      const result = { ...state, drawnHeight }; samples.push(result); return result
    }
    const aim = async point => {
      const tracking = await page.evaluate(([x, y, h]) => {
        const c = window.__spinwardCity, camera = window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera', true)[0]
        const p = camera.position.clone().set(Math.cos(x / 3200) * (3200 - h - 1.6), y, Math.sin(x / 3200) * (3200 - h - 1.6))
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
      const start = await sample(); await aim(target); await capture('start')
      let arrived = false, still = 0, previous = start
      for (let i = 0; i < 180; i++) {
        const state = await sample(), remaining = Math.hypot(state.x - target[0], state.y - target[1])
        if (kind !== 'balcony' && remaining < .75) { arrived = true; break }
        const moved = Math.hypot(state.x - previous.x, state.y - previous.y)
        if (moved < .015) still++; else still = 0
        if (kind === 'balcony' && i > 8 && still >= 8) { arrived = true; break }
        previous = state
        await aim(target); await xr.setAxes('left', 0, -Math.min(.65, Math.max(.2, remaining / 6))); await xr.settle(200)
      }
      await xr.setAxes('left', 0, 0); await xr.settle(200)
      const end = await sample(); await capture('end')
      // At the door, a forward view naturally fills with its closed surface.
      // Turn back/down without moving the body to inspect the arrived support.
      const backLength = Math.hypot(start.x - end.x, start.y - end.y)
      await aim([end.x + (start.x - end.x) * 2 / backLength,
        end.y + (start.y - end.y) * 2 / backLength, end.h - 1.5])
      await capture('end-surface')
      expect(arrived, kind === 'balcony' ? 'sustained stick input stops at the guard' : 'reach the entrance by walking the drawn access').toBe(true)
      const distance = Math.hypot(end.x - start.x, end.y - start.y)
      if (kind === 'balcony') {
        expect(distance).toBeGreaterThan(.12); expect(distance).toBeLessThan(.9)
        expect(Math.abs(end.h - start.h)).toBeLessThan(.1)
      } else {
        expect(distance).toBeGreaterThan(parcel.access.length - 1.6)
        expect(Math.abs(end.h - parcel.floor)).toBeLessThan(.3)
      }
      let returned
      if (kind === 'stairs') {
        let reached = false
        for (let i = 0; i < 180; i++) {
          const state = await sample(), remaining = Math.hypot(state.x - startPoint[0], state.y - startPoint[1])
          if (remaining < .75) { reached = true; break }
          await aim(startPoint); await xr.setAxes('left', 0, -Math.min(.65, Math.max(.2, remaining / 6))); await xr.settle(200)
        }
        await xr.setAxes('left', 0, 0); await xr.settle(200)
        returned = await sample(); await capture('returned')
        expect(reached, 'walk the same staircase back uphill with stick input').toBe(true)
        expect(Math.abs(returned.h - start.h)).toBeLessThan(.3)
      }
      await xr.endSession({ sessionId: diagnostic.session.id, timeout: 5000 })
      expect(errors).toEqual([]); expect(failures).toEqual([])
      await fs.writeFile(info.outputPath('report.json'), JSON.stringify({ parcel: parcel.id, kind, gpu: drawing.gpu, diagnostic, start, end, returned, distance, samples, captures }, null, 2))
    } finally {
      geometry.dispose(); material.dispose()
      await fs.writeFile(info.outputPath('samples.json'), JSON.stringify({ parcel: parcel.id, kind, samples, errors, failures }, null, 2))
    }
  })
}
