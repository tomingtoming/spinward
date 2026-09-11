import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as T from 'three'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const out = fileURLToPath(new URL('.', import.meta.url))
const base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192'
const prefix = process.env.PREFIX ?? 'crosswalk-clearance'
const tier = process.env.TIER ?? 'desktop'
const time = process.env.TIME ?? '.9'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const reports = []
  for (const scene of (process.env.SCENES ?? 'axial,tangent,lamps').split(',')) {
    // First arterial/local junction south of spawn (the spawn game plaza
    // has no zebra). Three camera positions expose angle-dependent stripe loss.
    for (const step of (scene === 'lamps' ? [0] : [0, 1, 2])) {
      const axial = scene !== 'tangent'
      const junctionAxial = scene === 'lamps' ? 0 : -321.290322580644
      const approach = scene === 'lamps' ? -90 : -19 + step * 2
      const a = axial ? 0 : approach / 3200
      const ax = junctionAxial + (axial ? approach : 0)
      const ta = axial ? 0 : 6 / 3200
      const tx = junctionAxial + (scene === 'lamps' ? 130 : axial ? 6 : 0)
      const pos = new T.Vector3(Math.cos(a) * 3197.6, ax, Math.sin(a) * 3197.6)
      const aimRadius = scene === 'lamps' ? 3188 : 3199.4
      const aim = new T.Vector3(Math.cos(ta) * aimRadius, tx, Math.sin(ta) * aimRadius)
      const q = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(pos, aim, new T.Vector3(-Math.cos(a), 0, -Math.sin(a))))
      const url = base + `/?debug&stats&m=f&p=${pos.toArray()}&q=${q.toArray()}&rpm=0&t=${time}&dpr=1&tier=${tier}`
      const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: tier === 'phone' ? { width: 390, height: 844 } : { width: 1440, height: 1000 } })
      const errors = []
      page.on('pageerror', e => errors.push(e.message))
      page.on('console', m => { if (m.type() === 'error' && /shader|WebGLProgram/.test(m.text())) errors.push(m.text()) })
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForSelector('#splash', { state: 'detached' })
      await page.waitForFunction(() => window.__spinwardCity.colonyBuildings.group.userData.asset)
      await page.waitForTimeout(1000)
      const data = await page.evaluate(() => {
        const city = window.__spinwardCity
        const pools = [], stripes = []
        window.__spinwardScene.traverse(o => {
          if (o.isInstancedMesh && o.geometry.type === 'CircleGeometry' && o.geometry.parameters.segments === 24 && o.renderOrder === 20) pools.push(o.count)
          if (o.isInstancedMesh && o.geometry.type === 'BoxGeometry' && o.geometry.parameters.height === .02) stripes.push(o.count)
        })
        document.querySelector('.lil-gui')?.remove()
        const panels = []
        window.__spinwardScene.traverse(o => { if (o.renderOrder === 30) panels.push(o) })
        panels.forEach(o => o.removeFromParent())
        return { floatingDots: city.lamps?.count ?? 0, supportedLampPools: pools, crosswalkBars: stripes, roadTiles: city.roadTileMeshes.length, stats: document.querySelector('.stats-overlay')?.textContent }
      })
      await page.screenshot({ path: out + `${prefix}-${scene}-${step}.png` })
      const motion = []
      if (process.env.MOTION === '1' && scene === 'axial' && step === 0) {
        await page.keyboard.down('w')
        try {
          for (let frame = 0; frame < 3; frame++) {
            await page.waitForTimeout(200)
            motion.push(await page.evaluate(() => ({ axial: window.__spinward.axial, radial: window.__spinward.radial })))
            await page.screenshot({ path: out + `${prefix}-motion-${frame}.png` })
          }
        } finally { await page.keyboard.up('w') }
        if (motion.at(-1).axial - motion[0].axial < .5) throw Error('Motion probe did not move forward')
      }
      if (errors.length) throw Error(JSON.stringify(errors))
      if (process.env.EXPECT_FIXED === '1' && (data.floatingDots !== 0 || !data.supportedLampPools.some(n => n > 0) || !data.crosswalkBars.some(n => n > 0))) throw Error(JSON.stringify(data))
      reports.push({ scene, step, tier, time, url, ...data, motion, errors })
      console.log(JSON.stringify(reports.at(-1)))
      fs.writeFileSync(out + prefix + '.json', JSON.stringify(reports, null, 2))
      await page.close()
    }
  }
} finally { await browser.close() }
