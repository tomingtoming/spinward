import type { CityBuilding, CityPatch, CityPlan, CityRoad } from './cityLayout'
import { sampleCitySurface } from './citySurfaceMesh'

export type RiverPoint = [number, number, number]
export type RiverSurface = { material: 'earth' | 'stone' | 'road' | 'water' | 'arch' | 'paint'; collider: CityBuilding }
export type RiverBox = { x: number; y: number; h: number; w: number; d: number; height: number; yaw: number; pitch?: number; material: 'stone' | 'metal' | 'wood' | 'light' }
export type RiverDistrict = {
  azimuth: number; axial: number; width: number; length: number; patch: CityPatch
  connections: [CityRoad, CityRoad]; sidewalkCuts: CityRoad[]; surfaces: RiverSurface[]; boxes: RiverBox[]
  buildings: CityBuilding[]; colliders: CityBuilding[]; roadSurfaces: CityBuilding[]
}
export const RIVER_STREET_HEIGHT = 5.2, RIVER_WALK_HEIGHT = 1.2, RIVER_WATER_HEIGHT = .65
export const RIVER_BRIDGE_YAW = Math.atan(.25)
const clamp = (x: number) => Math.min(1, Math.max(0, x))
const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x))
export const riverCentre = (y: number) => 9 * Math.sin(y / 62)
export const riverWalkHeight = (y: number) => 1.2 + 3.8 * clamp((Math.abs(y) - 50) / 45)

/** The shared centreline drives pavement and traffic in the district's metric frame. */
export function riverRoadGeometry(p: RiverDistrict, radius: number) {
  const [west,east]=p.connections
  const left=wrap(west.azimuth-p.azimuth)*radius+west.tangentWidth/2
  const right=wrap(east.azimuth-p.azimuth)*radius-east.tangentWidth/2
  const grade=(x:number)=>5*clamp((x<0?x-left:right-x)/(x<0?-72-left:right-72))
  const point=(x:number,offset:number,lift=.2):RiverPoint=>{
    const edge=x<0?left:right,sign=x<0?1:-1,t=clamp((sign*(x-edge)-4)/20)
    const y=t<1?.25*(edge+sign*24*t*t*(13/6-7*t/6)):.25*x
    const angle=Math.atan(t<1?.3*(13*t/3-3.5*t*t):.25)
    return [x-Math.sin(angle)*offset,y+Math.cos(angle)*offset,grade(x)+lift]
  }
  return {left,right,grade,point}
}

/** One undeveloped block, with both bridge approaches connected to real roads.
 * The pressure hull stays continuous; soil and the water channel sit above it.
 * No generated occupied parcel or through-road is removed to force a fit. */
export function planRiverDistrict(city: CityPlan, radius: number): RiverDistrict | null {
  if (radius < 2000) return null
  const patch = city.patches.filter(p => p.kind === 'park' && p.tangentExtent > 205 && p.tangentExtent < 230 && p.axialExtent > 300 && p.axialExtent < 330 &&
    p.azimuth > 0 && p.azimuth * radius < 750 && p.axial > 1200 && p.axial < 1800)
    .sort((a, b) => a.axial - b.axial || a.azimuth - b.azimuth)[0]
  if (!patch) return null
  const azimuth = patch.azimuth, axial = patch.axial
  const overlaps = (a: number, y: number, w: number, d: number) => Math.abs(wrap(a - azimuth) * radius) < (w + patch.tangentExtent) / 2 && Math.abs(y - axial) < (d + patch.axialExtent) / 2
  if (city.buildings.some(b => overlaps(b.azimuth, b.axial, b.width, b.depth)) || city.roads.some(r => overlaps(r.azimuth, r.axial, r.tangentWidth, r.axialLength))) return null
  const avenues = city.roads.filter(r => r.axialLength > r.tangentWidth && Math.abs(r.axial - axial) + 50 < r.axialLength / 2)
  const closest = (side: number) => avenues.filter(r => side * wrap(r.azimuth - azimuth) > 0)
    .sort((a, b) => Math.abs(wrap(a.azimuth - azimuth)) - Math.abs(wrap(b.azimuth - azimuth)))[0]
  const west = closest(-1), east = closest(1)
  if (!west || !east || [west, east].some(r => Math.abs(wrap(r.azimuth - azimuth)) * radius > 140)) return null
  const p: RiverDistrict = { azimuth, axial, width: patch.tangentExtent, length: patch.axialExtent, patch,
    connections: [west, east], sidewalkCuts: [], surfaces: [], boxes: [], buildings: [], colliders: [], roadSurfaces: [] }
  const surface = (material: RiverSurface['material'], raw: RiverPoint[], solid = true, road = false) => {
    const points: RiverPoint[] = []
    for(let i=0;i<raw.length;i+=3){const [a,b,c]=raw.slice(i,i+3),u=b.map((n,k)=>n-a[k]),v=c.map((n,k)=>n-a[k]);
      const area=(u[1]*v[2]-u[2]*v[1])**2+(u[2]*v[0]-u[0]*v[2])**2+(u[0]*v[1]-u[1]*v[0])**2;
      if(area>1e-12)points.push(a,b,c)}
    if(!points.length)return
    const xs = points.map(v => v[0]), ys = points.map(v => v[1]), hs = points.map(v => v[2])
    const x = (Math.min(...xs) + Math.max(...xs)) / 2, y = (Math.min(...ys) + Math.max(...ys)) / 2
    const b: CityBuilding = { azimuth: azimuth + x / radius, axial: axial + y,
      width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...ys) - Math.min(...ys),
      height: Math.max(...hs) - Math.min(...hs), baseHeight: Math.min(...hs),
      groundSurface: material !== 'arch', groundMargin: 0, collisionMargin: 0, kind: 'block', tone: .5,
      surfaceMesh: points.flatMap(v => [v[0] - x, v[1] - y, v[2]]) }
    p.surfaces.push({ material, collider: b }); if (solid) p.colliders.push(b); if (road) p.roadSurfaces.push(b)
  }
  const quad = (a: RiverPoint, b: RiverPoint, c: RiverPoint, d: RiverPoint) => [a, b, c, a, c, d]
  const upper = (y: number) => 5 * clamp((p.length / 2 - Math.abs(y)) / 35)
  const section = (y: number): RiverPoint[] => {
    const c = riverCentre(y), u = upper(y), end = clamp((Math.abs(y) - 110) / 10)
    const bed = .12 + (u - .12) * end, low = Math.min(u, riverWalkHeight(y))
    const xs = [-p.width / 2, -72, c - 24, c - 18, c - 18, c - 9.5, c - 9.5, c + 9.5, c + 9.5, c + 18, c + 18, c + 24, 72, p.width / 2]
    const hs = [.08, u, u, u, low, low, bed, bed, low, low, u, u, u, .08]
    return xs.map((x, i) => [x, y, hs[i]])
  }
  // Two-metre chords; group six adjacent rows into each streamed mesh. Vertical
  // faces are part of the same watertight section, not a separate visual skin.
  const count = Math.ceil(p.length / 2), step = p.length / count
  const rows = [...new Set([...Array.from({ length: count + 1 }, (_, i) => -p.length / 2 + i * step), -120, -110, -95, -50, 0, 50, 95, 110, 120])].sort((a, b) => a - b)
  for (let start = 0; start < rows.length - 1; start += 6) {
    const bins: Record<string, RiverPoint[]> = { earth: [], stone: [] }
    for (let row = start; row < Math.min(rows.length - 1, start + 6); row++) {
      const a = section(rows[row]), b = section(rows[row + 1])
      for (let j = 0; j < a.length - 1; j++) {
        const splits = Math.max(1, Math.ceil(Math.max(a[j + 1][0] - a[j][0], b[j + 1][0] - b[j][0]) / 4))
        const mix = (v: RiverPoint, w: RiverPoint, t: number): RiverPoint => [v[0] + (w[0] - v[0]) * t, v[1], v[2] + (w[2] - v[2]) * t]
        for (let k = 0; k < splits; k++) bins[j >= 3 && j <= 9 ? 'stone' : 'earth'].push(...quad(mix(a[j], a[j + 1], k / splits), mix(a[j], a[j + 1], (k + 1) / splits), mix(b[j], b[j + 1], (k + 1) / splits), mix(b[j], b[j + 1], k / splits)))
      }
    }
    for (const material of ['earth', 'stone'] as const) surface(material, bins[material])
  }
  const water: RiverPoint[] = []
  for (let y = -110; y < 110; y += 2) {
    const at = (x: number, z: number): RiverPoint => [riverCentre(z) + x, z, RIVER_WATER_HEIGHT]
    water.push(...quad(at(-9.5, y), at(9.5, y), at(9.5, y + 2), at(-9.5, y + 2)))
  }
  surface('water', water, false)
  const addBox = (b: RiverBox, solid = true) => {
    p.boxes.push(b)
    if (solid) p.colliders.push({ azimuth: azimuth + b.x / radius, axial: axial + b.y, width: b.w, depth: b.d,
      height: b.height, baseHeight: b.h, yaw: b.yaw, collisionMargin: 0, groundMargin: 0, kind: 'block', tone: .5 })
  }
  const rail = (x0: number, y0: number, h0: number, x1: number, y1: number, h1: number) => {
    const yaw = Math.atan2(y1 - y0, x1 - x0), length = Math.hypot(x1 - x0, y1 - y0)
    // Rise is gradual on ramps; each two-metre panel retains real clear headroom.
    const h = Math.min(h0, h1)
    addBox({ x: x0, y: y0, h: h0, w: .075, d: .075, height: 1.1, yaw, material: 'metal' }, false)
    for (const offset of [.53, 1.07]) addBox({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, h: (h0 + h1) / 2 + offset,
      w: Math.hypot(length,h1-h0) + .025, d: .055, height: .055, yaw, pitch: Math.atan2(h1-h0,length), material: 'metal' }, false)
    p.colliders.push({ azimuth: azimuth + (x0 + x1) / (2 * radius), axial: axial + (y0 + y1) / 2,
      width: length, depth: .08, height: 1.1 + Math.abs(h1 - h0), baseHeight: h, yaw, collisionMargin: 0, groundMargin: 0, kind: 'block', tone: .5 })
  }
  for (const side of [-1, 1]) for (let y = -108; y < 108; y += 2) {
    rail(riverCentre(y) + side * 9.65, y, riverWalkHeight(y), riverCentre(y + 2) + side * 9.65, y + 2, riverWalkHeight(y + 2))
    if (Math.abs(y) < 92) {
      const x0=riverCentre(y)+side*18.15,x1=riverCentre(y+2)+side*18.15,c=Math.cos(RIVER_BRIDGE_YAW)
      const d0=(y-.25*x0)*c,d1=(y+2-.25*x1)*c
      for(const sign of [-1,1]) {
        const a=sign*d0-6.12,b=sign*d1-6.12
        if(a<0&&b<0)continue
        const lo=a>=0?0:-a/(b-a),hi=b>=0?1:-a/(b-a)
        rail(x0+(x1-x0)*lo,y+2*lo,5,x0+(x1-x0)*hi,y+2*hi,5)
      }
    }
  }
  const {left,right,point:roadPoint}=riverRoadGeometry(p,radius)
  for(const [edge,sign] of [[left,1],[right,-1]]) p.sidewalkCuts.push({azimuth:azimuth+(edge+sign*2)/radius,axial:axial+.25*edge,tangentWidth:4.4,axialLength:7,kind:'local'})
  const c = Math.cos(RIVER_BRIDGE_YAW), s = Math.sin(RIVER_BRIDGE_YAW)
  const n = Math.ceil((right - left) / 2)
  for (let i = 0; i < n; i++) {
    const a = left + i * (right - left) / n, b = left + (i + 1) * (right - left) / n
    if (i % 4 < 2) surface('paint', quad(roadPoint(a, -.055, .208), roadPoint(b, -.055, .208), roadPoint(b, .055, .208), roadPoint(a, .055, .208)), false)
    surface('road', quad(roadPoint(a, -3.5, .2), roadPoint(b, -3.5, .2), roadPoint(b, 3.5, .2), roadPoint(a, 3.5, .2)), true, true)
    for (const side of [-1, 1]) surface('stone', quad(roadPoint(a, side * 3.5, .34), roadPoint(b, side * 3.5, .34), roadPoint(b, side * 5.8, .34), roadPoint(a, side * 5.8, .34)), true, true)
  }
  // Original masonry arch: deck carries the diagonal street, the lower paths
  // remain open beneath both springings. The Blender asset follows this recipe.
  for (let x = -25; x < 25; x += 2) {
    const at = (u: number, z: number, h: number): RiverPoint => [u * c - z * s, u * s + z * c, h]
    const bottom = (u: number) => 3.75 + .9 * Math.cos(u / 25 * Math.PI / 2)
    const points: RiverPoint[] = []
    for (const z of [-5.8, 5.8]) points.push(...quad(at(x, z, bottom(x)), at(x + 2, z, bottom(x + 2)), at(x + 2, z, 5.15), at(x, z, 5.15)))
    points.push(...quad(at(x, -5.8, bottom(x)), at(x, 5.8, bottom(x)), at(x + 2, 5.8, bottom(x + 2)), at(x + 2, -5.8, bottom(x + 2))))
    surface('arch', points)
  }
  for (const side of [-1, 1]) {
    // Open the parapet where the supported upper promenade meets the bridge.
    // Retain it over the channel and the lower bank's retaining drop.
    const bankOffset = (u: number) => u * c - side * 5.94 * s - riverCentre(u * s + side * 5.94 * c)
    const crossing = (offset: number) => {
      let lo = -40, hi = 40
      for (let i = 0; i < 35; i++) {
        const mid = (lo + hi) / 2
        if (bankOffset(mid) < offset) lo = mid; else hi = mid
      }
      return (lo + hi) / 2
    }
    const cuts = [-23, -19, 19, 23].map(crossing)
    for (let x = -25; x < 25; x += 2) {
      const ends = [x, ...cuts.filter(u => u > x && u < x + 2), x + 2]
      for (let i = 1; i < ends.length; i++) {
        const u = (ends[i - 1] + ends[i]) / 2, offset = Math.abs(bankOffset(u))
        if (offset > 19 && offset < 23) continue
        addBox({ x: u * c - side * 5.94 * s, y: u * s + side * 5.94 * c,
          h: 5.2, w: ends[i] - ends[i - 1], d: .3, height: 1.05, yaw: RIVER_BRIDGE_YAW, material: 'stone' })
      }
    }
    // Culvert headwalls close the visible reach into the colony's water circuit.
    const y = side * 110
    addBox({ x: riverCentre(y), y, h: .12, w: 19, d: .8, height: 4.4, yaw: 0, material: 'stone' })
    for (const x of [-5, 0, 5]) addBox({ x: riverCentre(y) + x, y: y - side * .43, h: .6, w: 3.8, d: .08, height: 2.5, yaw: 0, material: 'metal' }, false)
  }
  // Buildings face the actual oblique street. Local frontage widths and the
  // shared Blender facade/roof recipes retain residential and commercial variety.
  for (const side of [-1, 1] as const) for (const [i, x] of [-58, -37, 39, 60].entries()) {
    const y = .25 * x + side * 18.5
    const b: CityBuilding = { azimuth: azimuth + x / radius, axial: axial + y, width: i % 2 ? 14 : 17, depth: 15,
      height: [15, 23, 19, 12][(i + (side > 0 ? 1 : 0)) % 4], baseHeight: 5.34, yaw: RIVER_BRIDGE_YAW,
      kind: i % 2 ? 'setback' : 'block', front: { axis: 'axial', side: side === 1 ? -1 : 1 }, streetKind: 'collector', urban: .6,
      oldTown: .7, tone: .23 + ((i * 3 + side + 7) % 7) * .095 }
    p.buildings.push(b)
    addBox({x,y,h:5,w:b.width,d:b.depth,height:.34,yaw:RIVER_BRIDGE_YAW,material:'stone'})
    const distance=side*y*c-side*x*s, gap=distance-b.depth/2-5.8
    const normal=side*(b.depth/2+gap/2)
    // A shallow plinth and flush forecourt join the front door to its sidewalk.
    addBox({x:x+s*normal,y:y-c*normal,h:5,w:b.width+.4,d:gap+.05,height:.34,yaw:RIVER_BRIDGE_YAW,material:'stone'})
  }
  for (const side of [-1, 1]) for (let y=-104; y<104; y+=2) {
    const polygon:RiverPoint[]=[[riverCentre(y)+side*19,y,5.14],[riverCentre(y)+side*23,y,5.14],
      [riverCentre(y+2)+side*23,y+2,5.14],[riverCentre(y+2)+side*19,y+2,5.14]]
    const distance=(v:RiverPoint)=>(v[1]-.25*v[0])*Math.cos(RIVER_BRIDGE_YAW)
    for(const sign of [-1,1]){
      const clipped:RiverPoint[]=[]
      for(let i=0;i<polygon.length;i++){
        const a=polygon[i],b=polygon[(i+1)%polygon.length],da=sign*distance(a)-5.8,db=sign*distance(b)-5.8
        if(da>=0)clipped.push([...a])
        if((da<0)!==(db<0)){const t=da/(da-db);clipped.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,5.34])}
      }
      for(const v of clipped)v[2]=5.14+.2*clamp((7.8-Math.abs(distance(v)))/2)
      const triangles:RiverPoint[]=[]
      for(let i=1;i<clipped.length-1;i++)triangles.push(clipped[0],clipped[i],clipped[i+1])
      surface('stone',triangles)
    }
  }
  // At each end, the two paths meet on level soil. Bevel their short crossing
  // across the one-metre verge so a paved route does not end at a grass kerb.
  for (const bank of [-1, 1]) for (const end of [-100, 100]) for (let y = end - 2; y < end + 2; y += 2) {
    const at = (offset: number, axial: number): RiverPoint => [riverCentre(axial) + bank * offset, axial, 5 + .14 * (offset - 18)]
    surface('stone', quad(at(18, y), at(19, y), at(19, y + 2), at(18, y + 2)))
  }
  return p
}

export function sampleRiverRoad(p: RiverDistrict | null, radius: number, azimuth: number, axial: number) {
  if (!p || Math.abs(wrap(azimuth - p.azimuth) * radius) > 145 || Math.abs(axial - p.axial) > 50) return 0
  let h = 0
  for (const b of p.roadSurfaces) h = Math.max(h, sampleCitySurface(b.surfaceMesh!, wrap(azimuth - b.azimuth) * radius, axial - b.axial))
  return h
}
