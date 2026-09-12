import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const out = fileURLToPath(new URL('.', import.meta.url)), base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192'
const browser = await chromium.launch({ channel: 'chrome', headless: true }), report = { errors: [], layouts: [], journeys: [] }
const distance = (a, b) => Math.hypot(Math.atan2(Math.sin(a.azimuth-b.azimuth), Math.cos(a.azimuth-b.azimuth))*b.radius, a.axial-b.axial)
try {
 for (const phone of [false, true]) {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, hasTouch: phone, viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 } })
  page.on('pageerror', e => report.errors.push(e.message))
  await page.goto(`${base}/?debug&lock=0&t=.42&dpr=1&visit=car-share${phone ? '&tier=phone' : ''}`)
  await page.waitForSelector('#splash', { state: 'detached' }); await page.waitForFunction(() => window.__spinwardCar?.group.userData.ready)
  await page.evaluate(() => { document.querySelector('.lil-gui')?.remove(); window.__spinwardOuting.face(0) })
  report.renderer = await page.evaluate(() => { const gl = document.querySelector('canvas').getContext('webgl2'); return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL) })
  assert(!/SwiftShader|llvmpipe/i.test(report.renderer))
  const click = async name => { const button = page.getByRole('button', { name, exact: true }); if (phone) await button.tap(); else await button.click() }
  const state = () => page.evaluate(() => ({ ...window.__spinward }))
  const shot = label => page.screenshot({ path: out+`ui-after-${phone ? 'phone' : 'desktop'}-${label}.png` })
  await page.waitForTimeout(800); await shot('walk')
  if (await page.getByRole('button', { name: 'Dismiss guide' }).isVisible()) {
    await click('Dismiss guide'); assert.equal(await page.locator('.tour-notice').isVisible(), false)
  }
  const viewports = phone ? [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }] : [{ width: 1280, height: 800 }]
  for (const viewport of viewports) {
    await page.setViewportSize(viewport); await page.waitForTimeout(150)
    const before = await state()
    const geometry = await page.locator('.dock').evaluate(el => ({ rect: el.getBoundingClientRect().toJSON(), buttons: [...el.querySelectorAll('button')].filter(b => b.getClientRects().length).map(b => ({ label: b.textContent, rect: b.getBoundingClientRect().toJSON() })) }))
    assert.deepEqual(geometry.buttons.map(b => b.label), ['Places', 'Explore', 'Menu']); assert(geometry.rect.height <= 46)
    for (const { rect } of geometry.buttons) assert(rect.height >= 44 && rect.width >= 44 && rect.x >= 0 && rect.right <= viewport.width)
    assert(await page.locator('.hud-live').isVisible()); assert.match(await page.locator('.hud-live').innerText(), /felt gravity/)
    await click('Menu')
    const menu = page.locator('.colony-menu'), box = await menu.boundingBox()
    assert(box.y >= 0 && box.x >= 0 && box.x+box.width <= viewport.width && box.y+box.height <= viewport.height)
    assert.equal(await page.locator('.dock').evaluate(el => el.getBoundingClientRect().height), geometry.rect.height)
    // Opening settings must stop held input, and keys used inside the menu must not move the body.
    await page.keyboard.down('w'); await page.waitForTimeout(300); await page.keyboard.up('w')
    assert(distance(before, await state()) < .15)
    await click('Sound on'); await page.waitForFunction(() => window.__spinward.room.audio.muted)
    await click('Sound off'); await page.waitForFunction(() => !window.__spinward.room.audio.muted)
    await click('Rain'); await page.waitForFunction(() => window.__spinward.raining)
    await click('Rain'); await page.waitForFunction(() => !window.__spinward.raining)
    assert.equal(await page.locator('#VRButton').count(), 0)
    if (phone) assert(await page.getByRole('button', { name: 'Motion look', exact: true }).isVisible())
    await shot(`menu-${viewport.width}`)
    await page.keyboard.press('Escape')
    assert(await page.getByRole('button', { name: 'Menu', exact: true }).evaluate(e => e === document.activeElement))
    await click('Places'); await shot(`places-${viewport.width}`)
    assert.equal(await page.getByRole('button', { name: 'Directions to Café', exact: true }).count(), 1)
    assert.equal(await page.getByRole('button', { name: 'Go now to Café', exact: true }).count(), 1)
    await page.keyboard.press('Escape')
    report.layouts.push({ phone, viewport, geometry, menu: box })
  }
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1280, height: 800 })
  // Nested settings open above the permanent Menu button; keyboard focus comes back there.
  await click('Menu'); await page.locator('.hud-chip--preset').focus(); await page.keyboard.press('Space')
  await page.keyboard.press('Escape'); assert(await page.getByRole('button', { name: 'Menu', exact: true }).evaluate(e => e === document.activeElement))
  await click('Menu'); await page.getByRole('button', { name: 'Controls', exact: true }).focus(); await page.keyboard.press('Enter')
  await page.waitForTimeout(5500); assert(await page.getByRole('dialog', { name: 'Controls' }).isVisible()); await shot('controls')
  await page.keyboard.press('Escape'); assert(await page.getByRole('button', { name: 'Menu', exact: true }).evaluate(e => e === document.activeElement))
  // One contextual car action, with Brake as the only driving touch button.
  await click('Use car share'); await page.waitForFunction(() => window.__spinward.drive.driving); await shot('drive')
  assert.equal(await page.getByRole('button', { name: 'Leave car', exact: true }).count(), 1)
  assert.equal(await page.getByRole('button', { name: 'Exit', exact: true }).count(), 0)
  assert.equal(await page.locator('.tour-notice').isVisible(), false)
  assert.match(await page.locator('.hud-live').innerText(), /km\/h/)
  if (phone) assert.deepEqual(await page.locator('.mobile-controls button:visible').allTextContents(), ['Brake'])
  await click('Menu'); await click('Street ▾'); await click('Switch Street / Experiment')
  await page.waitForFunction(() => window.__spinward.drive.mode === 'experiment')
  await click('Menu'); await click('Experiment ▾'); await click('Switch Street / Experiment')
  await page.waitForFunction(() => window.__spinward.drive.mode === 'street')
  await click('Leave car'); await page.waitForFunction(() => !window.__spinward.drive.driving)
  // Directions keep your position, while Go now really arrives. Same actions on touch.
  const start = await state(); await click('Places'); await click('Directions to Café')
  await page.waitForFunction(() => window.__spinward.outing.action === 'guide-cafe')
  assert(distance(start, await state()) < .2)
  await shot('directions'); await click('Cancel directions')
  await click('Places'); await click('Go now to Café'); await page.waitForFunction(() => window.__spinward.tour === 'visit-cafe')
  const arrived = await state(), anchor = await page.evaluate(() => window.__spinwardCity.getInteriorVisit('cafe'))
  assert(distance(arrived, { ...anchor, radius: arrived.radius }) < .3)
  report.journeys.push({ phone, directionsPreservedPose: true, arrival: { azimuth: arrived.azimuth, axial: arrived.axial } })
  await shot('cafe')
  await click('Explore'); await click('Exterior · see the whole colony'); await page.waitForFunction(() => window.__spinward.mode === 'free-fly')
  await click('Explore'); await click('Surface · Central Square'); await page.waitForFunction(() => window.__spinward.mode === 'grounded')
  // Holding W while opening a menu cancels intent. It stays stopped after closing without a fresh press.
  await page.keyboard.down('w'); await page.waitForTimeout(250); await click('Menu'); await page.keyboard.press('Escape')
  const stopped = await state(); await page.waitForTimeout(400); assert(distance(stopped, await state()) < .15); await page.keyboard.up('w')
  // Changing presets must rebuild availability, with Explore still usable in small habitats.
  for (const name of ['Cooper Station', 'Elysium', 'Playground Colony', 'Izma Colony']) {
    await click('Menu'); await page.locator('.hud-chip--preset').click()
    await page.locator('.preset-menu:not([hidden])').getByRole('button', { name, exact: true }).click()
    await page.waitForTimeout(700)
    const hasPlaces = await page.evaluate(() => !!window.__spinwardCity.getInteriorVisit('car-share'))
    assert.equal(await page.getByRole('button', { name: 'Places', exact: true }).isVisible(), hasPlaces)
    assert(await page.getByRole('button', { name: 'Explore', exact: true }).isVisible())
  }
  await page.close(); console.log(JSON.stringify({ phone, passed: true }))
 }
 assert.deepEqual(report.errors, [])
} finally { fs.writeFileSync(out+'ui-refinement.json', JSON.stringify(report, null, 2)); await browser.close() }
