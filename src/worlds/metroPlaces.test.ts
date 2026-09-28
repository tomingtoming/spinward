import { expect, test } from 'bun:test'
import data from './generated/metroPlaces.json'
import { metroPlacesForStudy } from './metroPlaces'

test('named places cannot be applied to a different geographical crop', () => {
  const study = { radius: data.radius, span: data.span,
    samples: data.frames.map(([id, band, frame]) => ({ id: id as string, band: band as number, frame })) }
  expect(metroPlacesForStudy(study)).toHaveLength(16)
  const reordered = { ...study, samples: study.samples.map(s => ({ ...s,
    frame: Object.fromEntries(Object.entries(s.frame as object).reverse()) })) }
  expect(metroPlacesForStudy(reordered)).toHaveLength(16)
  expect(metroPlacesForStudy({ ...reordered, samples: reordered.samples.map(s => ({ ...s,
    frame: { ...s.frame, angle: Number(s.frame.angle) + .01 } })) })).toEqual([])
  expect(metroPlacesForStudy({ ...study, radius: 30000 })).toEqual([])
  expect(metroPlacesForStudy({ ...study, samples: study.samples.map(s => ({ ...s, frame: {} })) })).toEqual([])
  expect(new Set(data.places.map(p => p.region)).size).toBe(3)
  expect(new Set(data.places.map(p => p.id)).size).toBe(data.places.length)
})
