import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192', out = fileURLToPath(new URL('.', import.meta.url))
const browser = await chromium.launch({ channel: 'chrome', headless: true }), errors = [], reports = []
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, hasTouch: true })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${base}/?debug&lock=0&t=.42&tier=phone&m=g&a=0&ax=60`)
  await page.waitForSelector('#splash', { state: 'detached' })
  await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 720, height: 390 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport); await page.waitForTimeout(250)
    const chip = page.getByRole('button', { name: viewport.width > 720 ? 'Places ▾' : 'Travel ▾', exact: true })
    const before = await page.evaluate(() => ({ ...window.__spinward }))
    await chip.focus(); await page.keyboard.press('Space')
    if (await chip.getAttribute('aria-expanded') !== 'true') throw Error('Space did not open the menu')
    const keys = []
    for (const key of ['ArrowDown', 'End', 'Home', 'ArrowUp']) {
      await page.keyboard.press(key)
      const focused = await page.evaluate(() => ({ label: document.activeElement.textContent, inMenu: !!document.activeElement.closest('.preset-menu'), rect: document.activeElement.getBoundingClientRect().toJSON() }))
      if (!focused.inMenu || focused.rect.top < 0 || focused.rect.bottom > viewport.height) throw Error('Keyboard focus escaped the visible menu: ' + JSON.stringify(focused))
      keys.push({ key, label: focused.label })
    }
    await page.keyboard.press('Escape')
    if (await chip.getAttribute('aria-expanded') !== 'false' || !await chip.evaluate(e => e === document.activeElement)) throw Error('Escape lost the opening control')
    const after = await page.evaluate(() => ({ ...window.__spinward }))
    const movement = Math.hypot(Math.atan2(Math.sin(after.azimuth-before.azimuth), Math.cos(after.azimuth-before.azimuth))*after.radius, after.axial-before.axial)
    if (movement > .1 || after.mode !== 'grounded') throw Error('Menu keys leaked into world movement')
    // The same screen coordinate must dismiss a pointer-opened menu without
    // the finishing click reopening the chip through the removed backdrop.
    const rect = await chip.boundingBox()
    await page.mouse.click(rect.x+rect.width/2, rect.y+rect.height/2)
    await page.mouse.click(rect.x+rect.width/2, rect.y+rect.height/2)
    if (await chip.getAttribute('aria-expanded') !== 'false') throw Error('Pointer dismissal reopened the menu')
    await chip.focus(); await page.keyboard.press('ArrowDown')
    const menu = page.locator('.preset-menu:not([hidden])'), bounds = await menu.boundingBox()
    if (!bounds || bounds.x < 0 || bounds.y < 0 || bounds.x+bounds.width > viewport.width+.5 || bounds.y+bounds.height > viewport.height+.5) throw Error('Menu leaves viewport: ' + JSON.stringify(bounds))
    const intercepted = await menu.evaluate(menu => {
      const box = menu.getBoundingClientRect(), failures = []
      for (const item of menu.querySelectorAll('button')) {
        const r = item.getBoundingClientRect()
        if (item.hidden || r.top < box.top+6 || r.bottom > box.bottom-6) continue
        for (const fraction of [.2, .8]) {
          const hit = document.elementFromPoint(r.left+r.width*fraction, r.top+r.height/2)
          if (!item.contains(hit)) failures.push({ label: item.textContent, interceptedBy: hit?.textContent })
        }
      }
      return failures
    })
    if (intercepted.length) throw Error('Gameplay controls intercept a menu item: ' + JSON.stringify(intercepted))
    await page.screenshot({ path: out+`keyboard-menu-${viewport.width}-${viewport.height}.png` })
    await page.keyboard.press('Escape')
    reports.push({ viewport, keys, movement, bounds })
  }
  fs.writeFileSync(out+'keyboard-menus.json', JSON.stringify({ errors, reports }, null, 2))
  console.log(JSON.stringify({ errors, reports }))
  if (errors.length) throw Error(JSON.stringify(errors))
} finally { await browser.close() }
