// Audit retained legacy facade canvases against actual scene ownership.
// Pixel storage is an RGBA-equivalent CPU estimate, not measured GPU memory.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const base = process.env.SPINWARD_URL ?? 'https://127.0.0.1:5192', out = fileURLToPath(new URL('.', import.meta.url))
const prefix = process.env.PREFIX ?? 'retired-building-assets'
const browser = await chromium.launch({ channel: 'chrome', headless: true }), errors = [], reports = []
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(base + '/?debug&lock=0&t=.42&tier=desktop&people=0')
  await page.waitForSelector('#splash', { state: 'detached' })
  for (const [preset, label] of [['izma', 'Izma Colony'], ['cooper', 'Cooper Station'], ['elysium', 'Elysium'], ['playground', 'Playground Colony']]) {
    await page.locator('.hud-chip--preset').click()
    await page.locator('.preset-menu:not([hidden])').getByRole('button', { name: label, exact: true }).click()
    await page.waitForFunction(label => document.querySelector('.hud-chip--preset')?.textContent === label, label)
    await page.getByRole('button', { name: 'Surface', exact: true }).click()
    await page.waitForTimeout(2500)
    const sample = await page.evaluate(() => {
      const city = window.__spinwardCity, materials = new Map(), images = new Set(), uses = [], dormant = []
      for (const key of ['buildingSideMaterials', 'houseBuildingSideMaterial', 'largeBuildingSideMaterials', 'towerBuildingSideMaterials', 'farBuildingSideMaterial', 'shopBandMaterials', 'buildingRoofMaterial', 'buildingSignMaterials', 'kenneyRoofMaterial', 'roofClutterMaterial', 'streetDetailPaintMaterial', 'streetDetailMetalMaterial', 'hedgeMaterial', 'fenceMaterial']) {
        const value = city[key]
        for (const material of Array.isArray(value) ? value : value ? [value] : []) {
          materials.set(material, key)
          for (const slot of ['map', 'emissiveMap']) if (material[slot]?.image) images.add(material[slot].image)
        }
      }
      window.__spinwardScene.traverse(object => {
        if (!object.material) return
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (materials.has(material)) {
            const record = { mesh: object.name, material: materials.get(material), count: object.count ?? 1 }
            ;(record.count ? uses : dormant).push(record)
          }
        }
      })
      return { materialCount: materials.size, canvases: [...images].map(image => [image.width, image.height]),
        rgbaBytes: [...images].reduce((bytes, image) => bytes + image.width * image.height * 4, 0), uses, dormant,
        modules: !!city.colonyBuildings.modules, body: window.__spinwardBody.group.userData.ready,
        buildings: city.colonyBuildings.group.userData }
    })
    reports.push({ preset, ...sample }); console.log(JSON.stringify({ preset, ...sample }))
    if (sample.uses.length) throw Error('A legacy building material still has a live scene owner')
    if (process.env.EXPECT_RETIRED && (sample.materialCount || sample.rgbaBytes || sample.dormant.length)) throw Error('Retired building allocations remain')
    await page.evaluate(() => document.querySelector('.lil-gui')?.remove())
    await page.screenshot({ path: out + prefix + '-' + preset + '.png' })
  }
  if (errors.length) throw Error(JSON.stringify(errors))
} finally {
  fs.writeFileSync(out + prefix + '.json', JSON.stringify({ errors, reports }, null, 2)); await browser.close()
}
