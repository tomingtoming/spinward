import { chromium } from '@playwright/test'
import { Matrix4, Quaternion, Vector3 } from 'three'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const base = process.env.SPINWARD_URL
if (!base) throw Error('SPINWARD_URL required')
const out = fileURLToPath(new URL(`../webxr/evidence/world-landscapes-20260917/${process.env.LABEL ?? 'desktop'}/`, import.meta.url))
await fs.mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const report = { errors: [], worlds: [], gpu: null }
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => report.errors.push(e.message))
  await page.goto('about:blank')
  report.gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2'), d = gl?.getExtension('WEBGL_debug_renderer_info')
    if (!d) throw Error('Unknown GPU')
    const r = gl.getParameter(d.UNMASKED_RENDERER_WEBGL); gl.getExtension('WEBGL_lose_context')?.loseContext(); return r
  })
  if (/SwiftShader|Software|llvmpipe/i.test(report.gpu)) throw Error('Hardware GPU required')
  await page.route('https://static.cloudflareinsights.com/**', r => r.fulfill({ status: 200, body: '' }))
  const boot = async query => {
    await page.goto(`${base}/?debug&metrics=off&lock=0&dpr=1&tier=quest&landscape=authored&t=.42&${query}`)
    await page.waitForSelector('#splash', { state: 'detached', timeout: 60000 })
    await page.waitForFunction(() => window.__spinward?.mode)
    await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
    if (await page.locator('.tour-notice button').count()) await page.locator('.tour-notice button').first().click()
  }
  const snapshot = () => page.evaluate(() => ({ world: window.__spinwardCity.authoredLandscape.group.userData,
    radius: window.__spinward.radius, a: window.__spinward.azimuth, y: window.__spinward.axial,
    h: window.__spinward.groundHeight, mode: window.__spinward.mode,
    expressway: window.__spinwardCity.getCityPlan()?.expressway,
    visit: window.__spinwardCity.getInteriorVisit('landscape') }))
  for (const id of ['izma', 'cooper', 'elysium']) {
    await boot(`preset=${id}`)
    const start = await snapshot()
    if (start.world.world !== id || start.mode !== 'grounded' || start.expressway !== null) throw Error('Wrong world or ghost expressway: '+JSON.stringify(start))
    await page.screenshot({ path: `${out}${id}-street.png` })
    await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW')
    const end = await snapshot(), distance = Math.hypot((end.a-start.a)*start.radius,end.y-start.y)
    if (distance < 2 || end.mode !== 'grounded') throw Error('Walking failed: '+JSON.stringify({id,start,end,distance}))
    await page.screenshot({ path: `${out}${id}-walk.png` })
    report.worlds.push({ id, start, end, distance })
    const radius = start.radius, at = [-370,-500,450], aim = [0,0,5]
    const point = ([x,y,h]) => new Vector3(Math.cos(x/radius)*(radius-h),y,Math.sin(x/radius)*(radius-h))
    const q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(point(at),point(aim),new Vector3(-Math.cos(at[0]/radius),0,-Math.sin(at[0]/radius))))
    const p = point([at[0],at[1],at[2]-1.8])
    await boot(`preset=${id}&m=f&rpm=0&p=${p.toArray()}&q=${q.toArray()}`)
    await page.screenshot({ path: `${out}${id}-overview.png` })
  }
  // All four choices stay in the same running application. The small drum
  // must dispose of the study before returning to the Izma one.
  for (const [id,label] of [['playground','Playground Colony'],['cooper','Cooper Station'],['elysium','Elysium'],['izma','Izma Colony']]) {
    await page.getByRole('button',{name:'Menu',exact:true}).click()
    await page.locator('.hud-chip--preset').focus(); await page.keyboard.press('Space')
    await page.locator('.preset-menu:not([hidden])').getByRole('button',{name:label,exact:true}).click()
    await page.waitForFunction(id => id==='playground'
      ? window.__spinward.radius===18 && !window.__spinwardCity.isAuthoredLandscape()
      : window.__spinwardCity.authoredLandscape.group.userData.world===id && window.__spinward.mode==='grounded',id)
    const state=await snapshot()
    if (id==='playground' && state.visit!==null) throw Error('Playground inherited the landscape')
    report.worlds.push({ switchTo:id, state })
  }
  if (report.errors.length) throw Error(report.errors.join('; '))
} finally {
  await fs.writeFile(`${out}desktop.json`, JSON.stringify(report,null,2))
  await browser.close()
}
console.log(JSON.stringify({gpu:report.gpu,worlds:report.worlds.map(w=>({id:w.id??w.switchTo,distance:w.distance})),errors:report.errors,out}))
