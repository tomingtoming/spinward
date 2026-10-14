import { describe, expect, test } from 'bun:test'

import { bandLocalFromLonLat, bandLocalNorth, nearestMetroPlace, projectJgd2011ZoneIX } from './jgd2011'

// Source pins from the inland-b study (metro-overview.json): pyproj EPSG:6668→6677.
const PINS = [
  { name: 'shibuya', position: [139.70056, 35.6595], projected: [-12021.384359769287, -37768.56846416137], band: 'west', local: [-1174.412526209419, 19299.999999999993] },
  { name: 'imperialPalace', position: [139.75325, 35.685], projected: [-7248.49012894746, -34944.71657762425], band: 'east', local: [336.9118245297386, 17347.853154159304] },
  { name: 'omiya', position: [139.6238012332773, 35.90628126122779], projected: [-18912.636328311233, -10377.53528484659], band: 'west', local: [855.7428443688921, -8871.555184184786] },
  { name: 'saitamaShintoshin', position: [139.6339, 35.893595], projected: [-18003.980229254106, -11786.936415173499], band: 'west', local: [205.63121107858433, -7325.779548207464] }
]
const ANGLE = -1.3962634015954636
const BANDS = [
  { id: 'east', band: 0, frame: { origin: [-9929.11983872236, -17801.912168926847] as [number, number], angle: ANGLE } },
  { id: 'central', band: 1, frame: { origin: [-13229.242294254544, -18383.812797479044] as [number, number], angle: ANGLE } },
  { id: 'west', band: 2, frame: { origin: [-16529.36474978673, -18965.71342603124] as [number, number], angle: ANGLE } }
]

describe('JGD2011 zone IX', () => {
  test('projects the study pins to within two centimetres of pyproj', () => {
    for (const pin of PINS) {
      const { east, north } = projectJgd2011ZoneIX(pin.position[0], pin.position[1])
      // The meridian-arc series differs from pyproj's by a constant ~1 cm; far
      // below GPS error and the 4 m ground raster.
      expect(Math.abs(east - pin.projected[0])).toBeLessThan(0.02)
      expect(Math.abs(north - pin.projected[1])).toBeLessThan(0.02)
    }
  })

  test('band-local coordinates match the study frames', () => {
    for (const pin of PINS) {
      const band = BANDS.find(b => b.id === pin.band)!
      const [x, y] = bandLocalFromLonLat(band.frame, pin.position[0], pin.position[1])
      expect(Math.abs(x - pin.local[0])).toBeLessThan(0.02)
      expect(Math.abs(y - pin.local[1])).toBeLessThan(0.02)
    }
  })

  test('north in band-local axes is a unit vector that agrees with the projection', () => {
    const frame = BANDS[0].frame
    const [nx, ny] = bandLocalNorth(frame)
    expect(Math.hypot(nx, ny)).toBeCloseTo(1, 12)
    // Step 100 m north of the palace pin and compare the local displacement.
    const pin = PINS[1]
    const a = bandLocalFromLonLat(frame, pin.position[0], pin.position[1])
    const b = bandLocalFromLonLat(frame, pin.position[0], pin.position[1] + 100 / 111_000)
    const d = [b[0] - a[0], b[1] - a[1]]
    const len = Math.hypot(d[0], d[1])
    // Grid convergence at 139.75°E (0.08° from the central meridian) is ~0.05°.
    expect(d[0] / len).toBeCloseTo(nx, 2)
    expect(d[1] / len).toBeCloseTo(ny, 2)
  })

  test('nearest arrival: Shibuya from the scramble, Omiya from the station', () => {
    const places = [
      { id: 'shibuya', label: '渋谷', spawn: [-1174.412526209419, 19299.999999999993], region: 'west' },
      { id: 'palace', label: '皇居', spawn: [336.9118245297386, 17347.853154159304], region: 'east' },
      { id: 'omiya', label: '大宮', spawn: [855.7428443688921, -8871.555184184786], region: 'west' }
    ]
    const scramble = nearestMetroPlace(BANDS, places, 139.70056, 35.6595, 3351.03, 40000)!
    expect(scramble.place.id).toBe('shibuya')
    expect(scramble.distance).toBeLessThan(0.05)
    expect(scramble.inside).toBe(true)
    const omiya = nearestMetroPlace(BANDS, places, 139.6238, 35.9063, 3351.03, 40000)!
    expect(omiya.place.id).toBe('omiya')
    expect(omiya.distance).toBeLessThan(20)
    // Chiba is off every band but still resolves to the closest arrival.
    const chiba = nearestMetroPlace(BANDS, places, 140.1, 35.6, 3351.03, 40000)!
    expect(chiba.inside).toBe(false)
    expect(chiba.place.id).toBe('palace')
  })
})
