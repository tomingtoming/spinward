import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192', out = fileURLToPath(new URL('.', import.meta.url))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = [], results = {}
const distance = (a, b) => Math.hypot(Math.atan2(Math.sin(a.azimuth-b.azimuth), Math.cos(a.azimuth-b.azimuth))*a.radius, a.axial-b.axial)
try {
  for (const phone of [false, true]) {
    const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: phone })
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${base}/?debug&lock=0&t=.42&tier=${phone ? 'phone' : 'desktop'}&m=g&a=0&ax=60`)
    await page.waitForSelector('#splash', { state: 'detached' })
    await page.waitForFunction(() => window.__spinwardBody.group.userData.ready)
    await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
    const state = () => page.evaluate(() => ({ ...window.__spinward }))
    const before = await state()
    if (phone) {
      await page.evaluate(() => {
        const canvas = document.querySelector('canvas')
        canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: 70, clientY: 600, bubbles: true }))
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, pointerType: 'touch', clientX: 70, clientY: 536 }))
      })
    } else await page.keyboard.down('w')
    await page.waitForTimeout(700)
    const moving = await state()
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.waitForTimeout(200)
    const stopped = await state()
    await page.waitForTimeout(700)
    const after = await state()
    const sample = { movementBeforeBlur: distance(before,moving), movementAfterBlur: distance(stopped,after), mode: after.mode }
    if (!phone) await page.keyboard.up('w')
    else await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 7, pointerType: 'touch' })))
    // The release that was lost during the interruption must not be necessary
    // for a fresh press to work after focus returns.
    await page.keyboard.down('w'); await page.waitForTimeout(500); await page.keyboard.up('w')
    sample.freshPressMovement = distance(after, await state())
    if (process.env.EXPECT_STOPPED === '1' && !phone) {
      // Queue a jump and then lose focus before the next animation frame.
      await page.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true }))
        window.dispatchEvent(new Event('blur'))
      })
      await page.waitForTimeout(400)
      if ((await state()).mode !== 'grounded') throw Error('A queued jump survived blur')
      // An actual DOM editing target exercises native key delivery and prevents
      // travel, rain, projectile cycling and movement while typing.
      await page.evaluate(() => {
        const field = document.createElement('input'); field.id = 'focus-probe'; field.style.cssText = 'position:fixed;top:80px;left:10px;z-index:99999'
        document.body.append(field); field.focus()
      })
      const editingStart = await state()
      await page.keyboard.type('wrcx 1234', { delay: 30 })
      await page.waitForTimeout(300)
      const editingEnd = await state()
      sample.editingMovement = distance(editingStart, editingEnd)
      if (sample.editingMovement > .08 || editingEnd.mode !== 'grounded' || editingEnd.raining || await page.locator('#focus-probe').inputValue() !== 'wrcx 1234') throw Error('Typing escaped into gameplay')
      await page.evaluate(() => document.querySelector('#focus-probe').remove())
      const rain = page.getByRole('button', { name: 'Rain', exact: true })
      await rain.focus(); await page.keyboard.press('Space')
      await page.waitForTimeout(400)
      sample.nativeRainActivation = (await state()).raining
      if (!sample.nativeRainActivation || (await state()).mode !== 'grounded') throw Error('Space did not belong exclusively to the focused button')
      await page.keyboard.press('Tab')
      sample.tabTarget = await page.evaluate(() => document.activeElement.tagName)
      if (!['BUTTON', 'A'].includes(sample.tabTarget)) throw Error('Native dock focus did not advance')
    }
    if (process.env.EXPECT_STOPPED === '1' && phone) {
      await page.evaluate(() => {
        const jump = [...document.querySelectorAll('.mobile-controls button')].find(b => b.textContent === 'Jump')
        jump.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 11, pointerType: 'touch', bubbles: true }))
        window.dispatchEvent(new Event('blur'))
      })
      await page.waitForTimeout(400)
      sample.jumpCleared = await page.evaluate(() => !document.querySelector('.mobile-controls button').classList.contains('is-active') && window.__spinward.mode === 'grounded')
      if (!sample.jumpCleared) throw Error('Touch jump survived cancellation')
    }
    if (process.env.EXPECT_STOPPED === '1') {
      await page.goto(`${base}/?debug&lock=0&t=.42&tier=${phone ? 'phone' : 'desktop'}&m=g&a=0&ax=0`)
      await page.waitForSelector('#splash', { state: 'detached' })
      await page.keyboard.press('e')
      await page.waitForFunction(() => window.__spinward.drive.driving && window.__spinward.drive.grounded)
      if (phone) await page.evaluate(() => {
        document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown', { pointerId: 14, pointerType: 'touch', clientX: 70, clientY: 600, bubbles: true }))
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 14, pointerType: 'touch', clientX: 70, clientY: 536 }))
      })
      else await page.keyboard.down('w')
      await page.waitForTimeout(350)
      const powered = (await state()).drive
      await page.evaluate(() => window.dispatchEvent(new Event('blur')))
      await page.waitForTimeout(600)
      const coasting = (await state()).drive
      if (!phone) await page.keyboard.up('w')
      sample.car = { poweredSpeed: powered.speed, coastingSpeed: coasting.speed, crashed: coasting.crashed, grounded: coasting.grounded }
      if (powered.speed < 3 || coasting.speed < 1 || coasting.speed > powered.speed * .99 || coasting.crashed || !coasting.grounded) throw Error('Cancelled throttle did not leave ordinary physical coasting: '+JSON.stringify(sample.car))
    }
    results[phone ? 'phone' : 'desktop'] = sample
    await page.screenshot({ path: out + `input-interruption-${phone ? 'phone' : 'desktop'}.png` })
    await page.close()
  }
  fs.writeFileSync(out + `input-interruption${process.env.PREFIX ? '-'+process.env.PREFIX : ''}.json`, JSON.stringify({ errors, results }, null, 2))
  console.log(JSON.stringify({ errors, results }))
  if (errors.length) throw Error(JSON.stringify(errors))
  for (const sample of Object.values(results)) {
    if (sample.movementBeforeBlur < .5 || sample.freshPressMovement < .4) throw Error('Input probe did not move through a clear space')
    if (process.env.EXPECT_STOPPED === '1' && sample.movementAfterBlur > .08) throw Error('Movement remained held after interruption')
  }
} finally { await browser.close() }
