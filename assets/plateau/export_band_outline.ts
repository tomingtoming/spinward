// Write the three Tokyo bands as GeoJSON polygons over the real city, so the
// colony's footprint can be viewed on any map (geojson.io, Google Earth).
//   bun assets/plateau/export_band_outline.ts <metro-overview.json> <out.geojson>
import { readFileSync, writeFileSync } from 'node:fs'
import { bandOutlineLonLat } from '../../src/worlds/geo/jgd2011'

const [src, out] = process.argv.slice(2)
if (!src || !out) throw Error('usage: export_band_outline.ts <metro-overview.json> <out.geojson>')
const study = JSON.parse(readFileSync(src, 'utf8')) as { bandWidth: number; span: number; layout: string; samples: { id: string; band: number; frame: { origin: [number, number]; angle: number }; anchor?: { name?: string } }[] }
const features = study.samples.map(s => ({
  type: 'Feature',
  properties: { id: s.id, band: s.band, name: s.anchor?.name ?? s.id, layout: study.layout, widthM: study.bandWidth, spanM: study.span },
  geometry: { type: 'Polygon', coordinates: [bandOutlineLonLat(s.frame, study.bandWidth, study.span).map(([lon, lat]) => [+lon.toFixed(6), +lat.toFixed(6)])] }
}))
writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }, null, 1) + '\n')
console.log(`${features.length} bands -> ${out}`)
