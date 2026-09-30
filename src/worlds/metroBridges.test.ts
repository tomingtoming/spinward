import { expect, test } from 'bun:test'
import catalog from './generated/metroBridges.json'
import transit from './generated/metroTransit.json'
import { metroBridgeMeshes, metroBridges, VIADUCT } from './metroBridges'

const study = { radius: catalog.radius, span: catalog.span,
  samples: catalog.frames.map(([id, band, frame]) => ({ id: id as string, band: band as number, frame })) }
const boxes = (m: { attributes: { position: Float32Array } }) => {
  const p = m.attributes.position, out: number[][] = []
  for (let o = 0; o < p.length; o += 24) out.push([p[o], p[o + 3], p[o + 1], p[o + 7], p[o + 2], p[o + 14]]) // x0 x1 y0 y1 h0 h1
  return out
}

test('viaducts span the whole window at the shared cut height and meet the tram line', () => {
  const bridges = metroBridges(study)
  expect(bridges.map(b => b.name)).toEqual(['山手線', '都電荒川線'])
  const { solid } = metroBridgeMeshes(study, 'east', -16), all = boxes(solid[0])
  for (const b of bridges) {
    expect(b.x1 - b.x0).toBeCloseTo(Math.PI / 3 * study.radius, 2)
    const deck = all.filter(([, , y0, y1, , h1]) => Math.abs(h1 - b.height) < 1e-3 && Math.abs(y1 - y0 - b.width) < 1e-3)
    expect(Math.min(...deck.map(d => d[0]))).toBeCloseTo(b.x0, 3); expect(Math.max(...deck.map(d => d[1]))).toBeCloseTo(b.x1, 3)
    const piers = all.filter(([, , y0, y1, h0]) => h0 === -16 && Math.abs((y0 + y1) / 2 - b.y) < 1e-3)
    expect(piers.length).toBe(Math.floor((b.x1 - 10 - b.x0 - 1e-6) / catalog.pierSpacing))
  }
  const arakawa = bridges.find(b => b.line === '荒川線')!, crossing = transit.lines[0].crossings[0]
  expect(arakawa.height).toBeCloseTo(crossing.height, 2)
  expect(arakawa.y).toBeCloseTo(crossing.y, 2)
})

test('only the strip owning a viaduct builds it, and nothing is laid on the windows', () => {
  for (const band of ['east', 'central', 'west']) {
    const { detail, solid } = metroBridgeMeshes(study, band, -16)
    expect(solid.length).toBe(band === 'east' ? 1 : 0)
    expect(detail.map(d => d.name)).toEqual(band === 'east' ? ['viaduct-rails'] : [])
  }
})
