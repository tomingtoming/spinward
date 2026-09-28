import { test, expect } from 'playwright-webxr'
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Raycaster, Vector3 } from 'three'
import fs from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const nativeRoot = process.env.SPINWARD_NATIVE_WATER_ROOT
if (nativeRoot && !isAbsolute(nativeRoot)) throw Error('Use an absolute SPINWARD_NATIVE_WATER_ROOT')
const plan = nativeRoot ? JSON.parse(await fs.readFile(resolve(nativeRoot, 'izma-waterworks-plan.json'))) : null
const examples = (plan?.facilities ?? []).filter(f => ['a-supply','b-recovery','c-supply'].includes(f.id)).map(f => ({
  ...f, floor: f.floor + 3.38,
  access: { start: [f.position[0]+12,f.position[1]+10.5,f.floor],
    end: [f.position[0]+12,f.position[1]+1.2,f.floor+3.38], length: 9.3 }
}))
if (nativeRoot && examples.length !== 3) throw Error('Three band/role waterworks examples are required')
if (!nativeRoot) test.skip('waterworks native candidate requires SPINWARD_NATIVE_WATER_ROOT',()=>{})

test.use({ xrStereoEnabled: true, xrIpd: .064, viewport: { width: 2560, height: 960 } })
for (const parcel of examples) test(`waterworks: ${parcel.id} stairs support a VR round trip`, async ({ page, xr }, info) => {
  test.setTimeout(180000)
  const errors = [], failures = [], samples = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('requestfailed', r => { if (!r.failure()?.errorText.includes('ERR_ABORTED')) failures.push(r.url() + ': ' + r.failure()?.errorText) })
  await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '' }))
  const startPoint = parcel.access.start.map((v, i) => v + (parcel.access.end[i] - v) * .25 / parcel.access.length)
  await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&landscape=authored&preset=izma&t=${parcel.band === 2 ? .9 : .42}&m=g&a=${startPoint[0] / 3200}&ax=${startPoint[1]}&gh=${startPoint[2]}`)
  await page.waitForSelector('#splash', { state: 'detached', timeout: 60000 })
  await page.waitForFunction(() => window.__spinward?.regional.state === 'ready' && !window.__spinward.regional.pendingArrival &&
    window.__spinwardCity.authoredColony.group.userData.pending === 0)
  const drawing = await page.evaluate(centre => {
    const gl = document.querySelector('canvas').getContext('webgl2'), d = gl.getExtension('WEBGL_debug_renderer_info')
    const positions = []
    window.__spinwardCity.authoredColony.group.traverseVisible(mesh => {
      if (!mesh.isMesh || !mesh.geometry?.attributes.position) return
      const attribute=mesh.geometry.attributes.position,index=mesh.geometry.index
      const length=index?.count ?? attribute.count
      for (let i=0;i<length;i+=3) {
        const ids=[0,1,2].map(j=>index ? index.getX(i+j) : i+j)
        const x=attribute.getX(ids[0]),y=attribute.getY(ids[0]),z=attribute.getZ(ids[0])
        const a=Math.atan2(z,x)-centre[0]/3200
        if(Math.abs(Math.atan2(Math.sin(a),Math.cos(a))*3200)<25 && Math.abs(y-centre[1])<25)
          for(const id of ids)positions.push(attribute.getX(id),attribute.getY(id),attribute.getZ(id))
      }
    })
    return { positions, gpu: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown' }
  }, parcel.position)
  expect(drawing.gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  expect(drawing.positions.length).toBeGreaterThan(9)
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(Float32Array.from(drawing.positions), 3))
  const material = new MeshBasicMaterial({ side: DoubleSide }), floor = new Mesh(geometry, material)
  const sample = async () => {
    const state = await page.evaluate(() => ({ ...window.__spinward, colony: window.__spinwardCity.authoredColony.group.userData,
      localLights: window.__spinwardScene.getObjectsByProperty('isPointLight',true)
        .filter(light=>light.name.startsWith('landscape-local-light-')).map(light=>({intensity:light.intensity,distance:light.distance})) }))
    const x0 = state.azimuth * state.radius
    const x = x0 + Math.round((parcel.position[0] - x0) / (Math.PI * 6400)) * Math.PI * 6400
    const outward = new Vector3(Math.cos(state.azimuth), 0, Math.sin(state.azimuth))
    const origin = outward.clone().multiplyScalar(3200 - state.groundHeight - .25); origin.y = state.axial
    const hit = new Raycaster(origin, outward, 0, 1).intersectObject(floor)[0]
    expect(hit, 'the live body has a drawn waterworks tread or landing below it').toBeDefined()
    const drawnHeight = 3200 - Math.hypot(hit.point.x, hit.point.z)
    expect(Math.abs(drawnHeight - state.groundHeight)).toBeLessThan(.18)
    expect(3200 - state.radial - drawnHeight).toBeGreaterThan(-.12)
    expect(state.mode).toBe('grounded')
    expect(state.regional.entries).toBeLessThanOrEqual(32)
    expect(state.regional.bytes).toBeLessThanOrEqual(24 * 1024 * 1024)
    expect(state.colony.loaded).toBeLessThanOrEqual(18)
    expect(state.colony.collisionCache.entries).toBeLessThanOrEqual(128)
    expect(state.colony.collisionCache.bytes).toBeLessThanOrEqual(4 * 1024 * 1024)
    expect(state.regional.failed).toEqual([]); expect(state.colony.failed).toEqual([])
    expect(state.localLights.length).toBeLessThanOrEqual(6)
    if (parcel.band === 2) expect(state.localLights.some(light=>light.intensity>1),'night stairs have a nearby working maintenance lamp').toBe(true)
    const result = { ...state, x, drawnHeight }; samples.push(result); return result
  }
  const aim = async target => {
    const tracking = await page.evaluate(([x, y, h]) => {
      const camera = window.__spinwardScene.getObjectsByProperty('isPerspectiveCamera', true)[0]
      const p = camera.position.clone().set(Math.cos(x / 3200) * (3200 - h - 1.6), y, Math.sin(x / 3200) * (3200 - h - 1.6))
      return camera.parent.worldToLocal(window.__spinwardCity.group.localToWorld(p)).toArray()
    }, target)
    const q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0, 1.6, 0), new Vector3(...tracking), new Vector3(0, 1, 0)))
    await xr.setHeadPose({ position: [0, 1.6, 0], quaternion: q.toArray() })
  }
  const walk = async (target, tolerance = .65) => {
    for (let i = 0; i < 140; i++) {
      const s = await sample(), remaining = Math.hypot(s.x - target[0], s.axial - target[1])
      if (remaining < tolerance) { await xr.setAxes('left', 0, 0); await xr.settle(200); return sample() }
      await aim(target); await xr.setAxes('left', 0, -Math.min(.65, Math.max(.2, remaining / 6))); await xr.settle(200)
      await xr.setAxes('left', 0, 0)
    }
    throw Error('Continuous VR stick movement did not reach the staircase endpoint')
  }
  try {
    await page.getByRole('button', { name: 'Menu', exact: true }).click(); await xr.enterVR()
    const diagnostic = await xr.diagnostics()
    expect(diagnostic.runtime.playwrightWebxrVersion).toBe('0.3.0')
    await xr.setControllerPose('left', { position: [-.4, .6, -.2], quaternion: [0, 0, 0, 1] })
    expect((await page.evaluate(()=>window.__spinwardCity.authoredColony.group.userData.waterworksFacilities))).toBe(6)
    const start = await sample(); await aim(parcel.access.end)
    await xr.screenshot(info.outputPath('stairs-start.png'), { canvas: 'canvas', metadata: true, timeout: 5000 })
    const end = await walk(parcel.access.end)
    expect(Math.hypot(end.x - start.x, end.axial - start.axial)).toBeGreaterThan(parcel.access.length - 1.2)
    expect(Math.abs(end.groundHeight - parcel.floor)).toBeLessThan(.3)
    await aim(startPoint)
    await xr.screenshot(info.outputPath('stairs-door-looking-out.png'), { canvas: 'canvas', metadata: true, timeout: 5000 })
    const returned = await walk(startPoint, .25)
    expect(Math.abs(returned.groundHeight - start.groundHeight)).toBeLessThan(.3)
    await xr.screenshot(info.outputPath('stairs-returned.png'), { canvas: 'canvas', metadata: true, timeout: 5000 })
    expect(errors).toEqual([]); expect(failures).toEqual([])
    await fs.writeFile(info.outputPath('report.json'), JSON.stringify({ parcel, diagnostic, gpu: drawing.gpu, start, end, returned }, null, 2))
    await xr.endSession({ sessionId: diagnostic.session.id, timeout: 5000 })
  } finally {
    geometry.dispose(); material.dispose()
    await fs.writeFile(info.outputPath('samples.json'), JSON.stringify({ parcel: parcel.id, samples, errors, failures }, null, 2))
  }
})
