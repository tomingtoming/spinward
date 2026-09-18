/** Compare actual ground-level building coverage inside unchanged street loops.
 * Usage: bun qa/neighborhood-life/audit-block-interiors.ts /absolute/baseline.json
 * Centreline boundaries include half of the surrounding road. This diagnostic
 * measures floor footprints, not roofs, inhabitants or reference-image scale.
 */
import fs from 'node:fs'
import { ShapeUtils, Vector2 } from 'three'
import { intersectStreetPolygons, polygonArea, positivePolygon } from '../../src/objects/streetPolygon'

const baselinePath = process.argv[2]
if (!baselinePath) throw Error('A saved baseline neighbourhood contract is required')
const read = (name: string) => JSON.parse(fs.readFileSync(new URL('../../assets/blender/' + name, import.meta.url), 'utf8'))
const before = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
const after = read('izma-neighbourhood-parcels.json'), primary = read('izma-parcels.json')
const polygon = (points: number[][]) => positivePolygon(points.map(([x,y]) => ({x,y,u:x,v:y})))
const footprints = (parcels: any[]) => parcels.flatMap(p => {
  const volumes = p.volumes ?? p.solids.slice(1, p.family === 'office' || p.family === 'civic' ? 3 : 2)
  return volumes.filter((v: number[]) => v[2] === 0 && v[5] > 0).map(([u,v,_z,w,d]: number[]) => {
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw)
    return {band:p.band, polygon:polygon([[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([x,y]) =>
      [p.position[0]+c*(x+u)-s*(y+v), p.position[1]+s*(x+u)+c*(y+v)]))}
  })
})
const previous = footprints([...primary.parcels, ...before.parcels])
const current = footprints([...primary.parcels, ...after.parcels])
const blocks = before.streets.filter((s:any) => !s.parents?.length && s.connections.length === 2 && s.points.length > 2).map((street:any) => {
  const retained = after.streets.find((s:any) => s.id === street.id)
  if (!retained || JSON.stringify(retained.points) !== JSON.stringify(street.points)) throw Error('Changed comparison boundary: '+street.id)
  const outline = polygon(street.points)
  const faces = ShapeUtils.triangulateShape(outline.map(p => new Vector2(p.x,p.y)), [])
  const triangles = faces.map(indices => positivePolygon(indices.map(i => outline[i])))
  const built = (volumes:ReturnType<typeof footprints>) => volumes.filter(p => p.band === street.band)
    .reduce((sum,p) => sum + triangles.reduce((area,tri) => area + polygonArea(intersectStreetPolygons(p.polygon,tri)),0),0)
  const area = polygonArea(outline), previousArea = built(previous), currentArea = built(current)
  if (area <= 0 || currentArea > area + .01 || previousArea > area + .01) throw Error('Invalid footprint coverage: '+street.id)
  return {id:street.id,district:street.district,area,previousArea,currentArea,
    previousCoverage:previousArea/area,currentCoverage:currentArea/area}
})
const districts:Record<string,{area:number;previousArea:number;currentArea:number}> = {}
for (const b of blocks) {
  const d = districts[b.district] ??= {area:0,previousArea:0,currentArea:0}
  d.area += b.area; d.previousArea += b.previousArea; d.currentArea += b.currentArea
}
console.log(JSON.stringify({method:'Ground-level body volumes clipped to identical retained street-centreline loops. Streets/gardens count in the denominator. Not roof coverage or a measurement of the animation.',blocks,districts},null,2))
