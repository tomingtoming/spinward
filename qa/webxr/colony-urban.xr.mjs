import { test, expect } from 'playwright-webxr'
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Raycaster, Vector3 } from 'three'
import fs from 'node:fs/promises'

const plan = JSON.parse(await fs.readFile(new URL('../../assets/blender/izma-neighbourhood-parcels.json', import.meta.url), 'utf8'))
const transport = JSON.parse(await fs.readFile(new URL('../../assets/blender/izma-transport.json', import.meta.url), 'utf8'))
test.use({ xrStereoEnabled: true, xrIpd: .064, viewport: { width: 2560, height: 960 } })
for (const [district,mode] of ['a-old-town','b-housing','c-market'].flatMap(d=>['back street','second-depth','centre link'].map(mode=>[d,mode]))) test(`${mode}: ${district} continuous route`, async ({ page, xr }, info) => {
  const deep=mode==='second-depth',centre=mode==='centre link'
  test.setTimeout(centre?600000:deep?480000:360000)
  const linkNames={'a-old-town':'north-row','b-housing':'housing-south','c-market':'market-north'}
  const street = centre?plan.streets.find(s=>s.id===`urban-${district}-link-${linkNames[district]}`):deep?plan.streets.filter(s=>s.district===district&&s.role==='back-lane').sort((a,b)=>plan.parcels.filter(p=>p.route===b.id).length-plan.parcels.filter(p=>p.route===a.id).length)[0]:plan.streets.find(s => s.district === district)
  expect(street,'authored street is actually built').toBeDefined()
  let path = [...street.profile]
  if(deep||centre){
    const parents=street.connections.map(id=>plan.streets.find(s=>s.id===id)??{
      profile:transport.profiles.find(s=>s.id===id).points.map(p=>[p[0]+street.band*Math.PI*6400/3,p[1],p[2]])
    })
    const near=(s,p)=>s.profile.reduce((best,q,i)=>Math.hypot(q[0]-p[0],q[1]-p[1])<Math.hypot(s.profile[best][0]-p[0],s.profile[best][1]-p[1])?i:best,0)
    const start=near(parents[0],path[0]),end=near(parents[1],path.at(-1))
    path=[...parents[0].profile.slice(Math.max(0,start-6),start+1),...path,...parents[1].profile.slice(end,end+7)]
    if(deep)path=[...path,...path.slice(0,-1).reverse()]
  }
  const startPoint = path[0]
  const errors = [], samples = [], captures = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '' }))
  await page.goto(`/?debug&metrics=off&lock=0&dpr=1&tier=quest&landscape=authored&preset=izma&t=${street.band === 2 ? .9 : .42}&m=g&a=${startPoint[0] / 3200}&ax=${startPoint[1]}&gh=${startPoint[2]}`)
  await page.waitForSelector('#splash', { state: 'detached' })
  await page.waitForFunction(() => window.__spinwardCity.authoredColony.group.userData.pending === 0)
  const drawing = await page.evaluate(points => {
    const colony = window.__spinwardCity.authoredColony.group
    const gl = document.querySelector('canvas').getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info')
    const positions = [], minY = Math.min(...points.map(p => p[1])) - 20, maxY = Math.max(...points.map(p => p[1])) + 20
    const extentX = Math.max(...points.map(p => Math.abs(p[0] - points[0][0]))) + 20
    for (const name of ['colony-base', 'colony-neighbourhood-ground']) for (const mesh of colony.getObjectByName(name).children) {
      const v = mesh.geometry.attributes.position.array
      for (let i = 0; i < v.length; i += 9) {
        const dx = Math.atan2(Math.sin(Math.atan2(v[i + 2], v[i]) - points[0][0] / 3200), Math.cos(Math.atan2(v[i + 2], v[i]) - points[0][0] / 3200)) * 3200
        if (Math.abs(dx) < extentX && v[i + 1] > minY && v[i + 1] < maxY) for (let j = 0; j < 9; j++) positions.push(v[i + j])
      }
    }
    return { positions, gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown' }
  }, path)
  expect(drawing.gpu).not.toMatch(/unknown|SwiftShader|Software|llvmpipe/i)
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(Float32Array.from(drawing.positions), 3))
  const material = new MeshBasicMaterial({ side: DoubleSide }), floor = new Mesh(geometry, material)
  const sample = async () => {
    const s = await page.evaluate(() => ({ ...window.__spinward, colony: window.__spinwardCity.authoredColony.group.userData }))
    s.x = s.azimuth * 3200; s.x += Math.round((startPoint[0] - s.x) / (Math.PI * 6400)) * Math.PI * 6400
    const out = new Vector3(Math.cos(s.azimuth), 0, Math.sin(s.azimuth)), origin = out.clone().multiplyScalar(3200 - s.groundHeight - .2); origin.y = s.axial
    const hit = new Raycaster(origin, out, 0, 1).intersectObject(floor)[0]
    expect(hit, 'rendered street supports the moving body').toBeDefined()
    const h = 3200 - Math.hypot(hit.point.x, hit.point.z)
    expect(Math.abs(s.groundHeight - h)).toBeLessThan(.18)
    expect(s.mode).toBe('grounded'); expect(s.colony.failed).toEqual([])
    expect(s.colony.loaded).toBeLessThanOrEqual(18)
    expect(s.colony.collisionCache.entries).toBeLessThanOrEqual(128)
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
    const start = await sample(); await aim(path[3]); await capture('street-entry')
    const targets = path.filter((p, i) => {
      if (i <= 1 || i % 4 === 0 || i >= path.length - 2) return true
      const a = path[i - 1], b = path[i + 1]
      const turn = Math.atan2(p[0] - a[0], p[1] - a[1]) - Math.atan2(b[0] - p[0], b[1] - p[1])
      return Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) > .1
    }).slice(1)
    for (let j = 0; j < targets.length; j++) {
      const target = targets[j]; let arrived = false
      for (let i = 0; i < 90; i++) {
        const s = await sample(), remaining = Math.hypot(s.x - target[0], s.axial - target[1])
        if (remaining < .25) { arrived = true; break }
        await aim(target); await xr.setAxes('left', 0, -Math.min(.95, Math.max(.15, remaining / 4))); await xr.settle(180)
        await xr.setAxes('left', 0, 0)
      }
      expect(arrived, `walk to ${target}`).toBe(true)
      if (j === Math.floor(targets.length / 2)) await capture('inside-block')
    }
    await xr.settle(200); const end = await sample(); await capture('street-return')
    if(deep)expect(Math.hypot(end.x-start.x,end.axial-start.axial)).toBeLessThan(.4)
    else expect(Math.hypot(end.x - start.x, end.axial - start.axial)).toBeGreaterThan(90)
    await xr.endSession({ sessionId: diagnostic.session.id, timeout: 5000 })
    expect(errors).toEqual([])
    await fs.writeFile(info.outputPath('report.json'), JSON.stringify({ street: street.id, gpu: drawing.gpu, diagnostic, start, end, captures }, null, 2))
  } finally {
    geometry.dispose(); material.dispose()
    await fs.writeFile(info.outputPath('samples.json'), JSON.stringify({ street: street.id, samples, errors }, null, 2))
  }
})
