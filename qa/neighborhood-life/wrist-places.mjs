// Exercise the real wrist canvas and UV hit/click route in ordinary Chrome.
// Synthetic UVs stand in for the laser; this is not headset or XR-runtime QA.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192'
const out = fileURLToPath(new URL('.', import.meta.url)), prefix = process.env.PREFIX ?? 'wrist-places'
const browser = await chromium.launch({ channel: 'chrome', headless: true }), reports = [], errors = []
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(base + '/?debug&lock=0&t=.42&tier=quest')
  await page.waitForSelector('#splash', { state: 'detached' })
  await page.waitForFunction(() => window.__spinwardWatch?.snapshot)
  const click = id => page.evaluate(id => {
    const panel = window.__spinwardWatch, layout = panel.layouts[panel.screen]
    const button = layout.buttons.find(button => button.id === id)
    if (!button) throw Error('No wrist target: ' + id)
    panel.updateHover({ x: (button.x + button.width / 2) / layout.width, y: 1 - (button.y + button.height / 2) / layout.height })
    return { accepted: panel.clickHovered(), hovered: panel.hasHover, screen: panel.screen }
  }, id)
  const capture = async (name, gravity = null) => {
    const result = await page.evaluate(gravity => {
      const panel = window.__spinwardWatch
      // The actual renderer owns the canvas. Scene objects supply the harmless
      // anchoring methods while no tracked controllers exist in this browser.
      const snapshot = gravity === null ? panel.snapshot : { ...panel.snapshot, feltGravity: gravity }
      panel.update(snapshot, true, window.__spinwardScene, window.__spinwardScene)
      return { image: panel.expandedCanvas.canvas.toDataURL('image/png'), screen: panel.screen,
        available: [...panel.snapshot.availablePlaces], muted: panel.snapshot.muted }
    }, gravity)
    fs.writeFileSync(out + prefix + '-' + name + '.png', Buffer.from(result.image.split(',')[1], 'base64'))
    delete result.image; return result
  }
  for (const [preset, label] of [['izma', 'Izma Colony'], ['cooper', 'Cooper Station'], ['elysium', 'Elysium'], ['playground', 'Playground Colony']]) {
    if (process.env.PRESET && preset !== process.env.PRESET) continue
    await click('nav-habitat'); await click('preset-apply-' + preset)
    await page.waitForFunction(label => window.__spinwardWatch.snapshot.currentPresetName === label, label)
    await page.waitForTimeout(1000)
    await click('nav-home'); await capture(preset + '-home')
    await click('audio-mute-toggle'); await page.waitForFunction(() => window.__spinwardWatch.snapshot.muted)
    await capture(preset + '-muted')
    await click('audio-mute-toggle'); await page.waitForFunction(() => !window.__spinwardWatch.snapshot.muted)
    await click('nav-places'); const places = await capture(preset + '-places')
    const visits = []
    for (const [id, kind] of [['visit-cafe', 'cafe'], ['visit-courtyard', 'court'], ['visit-apartment', 'nyaan'], ['visit-shops', 'shops'], ['visit-park', 'park']]) {
      if (process.env.CAPTURE_ONLY) break
      const before = await page.evaluate(kind => ({ target: window.__spinwardCity.getInteriorVisit(kind), azimuth: window.__spinward.azimuth, axial: window.__spinward.axial }), kind)
      const action = await click(id)
      if (!!before.target !== !!action.accepted) throw Error('Availability and wrist action disagree: ' + preset + '/' + id)
      if (!before.target && action.hovered) throw Error('Absent place retains an actionable laser hover')
      await page.waitForTimeout(500)
      const after = await page.evaluate(() => ({ mode: window.__spinward.mode, radius: window.__spinward.radius, azimuth: window.__spinward.azimuth, axial: window.__spinward.axial }))
      const target = before.target ?? before
      const error = Math.hypot(Math.atan2(Math.sin(after.azimuth - target.azimuth), Math.cos(after.azimuth - target.azimuth)) * after.radius, after.axial - target.axial)
      if (error > .8 || after.mode !== 'grounded') throw Error('Wrist travel missed entrance: ' + JSON.stringify({ preset, id, after, target, error }))
      visits.push({ id, available: !!before.target, accepted: action.accepted, error })
    }
    await click('nav-home'); await click('respawn-inner-wall')
    if (process.env.CAPTURE_ONLY) for (const gravity of [0, 9.80665, 14]) await capture(preset + '-gauge-' + gravity, gravity)
    reports.push({ preset, places, visits }); console.log(JSON.stringify(reports.at(-1)))
  }
  fs.writeFileSync(out + prefix + '.json', JSON.stringify({ errors, reports }, null, 2))
  if (errors.length) throw Error(JSON.stringify(errors))
} finally { await browser.close() }
