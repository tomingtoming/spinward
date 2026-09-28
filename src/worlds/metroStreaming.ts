import type { RegionalBody, RegionalMotion } from './regionalMotion'

export type Bounds3 = [number, number, number, number, number, number]
export type SpatialTile = { bounds: number[]; heightRange?: number[]; band: number }
export const METRO_CONTACT_MARGIN = 32 // Covers the 28 m collider window, body and support probes.

/** Conservative bounds of ALL source vertices (including owner-cell overhangs).
 * Chord triangles lie inside these bounds too. Include quadrant extrema, not
 * just four projected corners; the latter underestimates curved tile extents. */
export function metroTileBounds(tile: SpatialTile, radius: number): Bounds3 {
  const [x0,y0,x1,y1] = tile.bounds
  const a0 = -(tile.band * Math.PI * 2 / 3 + x1 / radius)
  const a1 = -(tile.band * Math.PI * 2 / 3 + x0 / radius)
  const heights = tile.heightRange ?? [-radius, radius]
  const radii = [radius - heights[1], radius - heights[0]]
  const angles = [a0, a1]
  for (let n = Math.ceil(a0 / (Math.PI / 2)); n * Math.PI / 2 < a1; n++) angles.push(n * Math.PI / 2)
  const xs = angles.flatMap(a => radii.map(r => r * Math.cos(a)))
  const zs = angles.flatMap(a => radii.map(r => r * Math.sin(a)))
  return [Math.min(...xs),-y1,Math.min(...zs),Math.max(...xs),-y0,Math.max(...zs)]
}
export const intersects = (a: Bounds3, b: Bounds3) => a[0]<=b[3]&&a[3]>=b[0]&&a[1]<=b[4]&&a[4]>=b[1]&&a[2]<=b[5]&&a[5]>=b[2]
const union = (a: Bounds3,b: Bounds3): Bounds3 => [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.min(a[2],b[2]),Math.max(a[3],b[3]),Math.max(a[4],b[4]),Math.max(a[5],b[5])]
type Node = { bounds: Bounds3; left?: Node; right?: Node; ids?: number[] }
/** Built once; per-frame work depends on intersecting branches, not all 10,200 tiles. */
export class MetroSpatialIndex {
  readonly bounds: Bounds3[]
  private root?: Node
  constructor(tiles: SpatialTile[], radius: number) {
    this.bounds = tiles.map(t => metroTileBounds(t,radius))
    const build = (ids: number[]): Node => {
      const bounds = ids.map(i=>this.bounds[i]).reduce(union)
      if(ids.length<=8) return { bounds,ids }
      const axis = [0,1,2].sort((a,b)=>(bounds[b+3]-bounds[b])-(bounds[a+3]-bounds[a]))[0]
      ids.sort((a,b)=>(this.bounds[a][axis]+this.bounds[a][axis+3])-(this.bounds[b][axis]+this.bounds[b][axis+3]))
      const mid = ids.length >> 1
      return { bounds,left:build(ids.slice(0,mid)),right:build(ids.slice(mid)) }
    }
    if(tiles.length) this.root=build(tiles.map((_,i)=>i))
  }
  query(bounds: Bounds3, visit: (id: number)=>void) {
    const walk=(node: Node)=>{
      if(!intersects(bounds,node.bounds))return
      if(node.ids) { for(const id of node.ids) if(intersects(bounds,this.bounds[id]))visit(id) }
      else { walk(node.left!);walk(node.right!) }
    }
    if(this.root)walk(this.root)
  }
}
const box = (p: {x:number;y:number;z:number}, radius: number): Bounds3 => [p.x-radius,p.y-radius,p.z-radius,p.x+radius,p.y+radius,p.z+radius]
const relativeSpeed = (b: RegionalBody) => Math.max(b.speedBound??0,Math.hypot(b.velocity.x,b.velocity.y,b.velocity.z))
// An upper bound for the second derivative in the rotating frame over [0,t].
const accelerationBound = (b: RegionalBody,w: number,t: number) => {
  w=Math.abs(w)
  const r=Math.hypot(b.position.x,b.position.z),v=relativeSpeed(b)+w*r,a=b.acceleration
  return a+2*w*(v+a*t)+w*w*(r+v*t+.5*a*t*t)
}
export function metroCriticalRadius(b: RegionalBody, motion: RegionalMotion) {
  const t=motion.deltaSeconds
  return METRO_CONTACT_MARGIN+b.radius+relativeSpeed(b)*t+.5*accelerationBound(b,motion.omega,t)*t*t
}
/** Exact constant-inertial-velocity coast, expressed in future rotating axes. */
export function metroCoast(b: RegionalBody, omega: number, t: number) {
  const p=b.position,v=b.velocity
  const x=p.x+(v.x+omega*p.z)*t,z=p.z+(v.z-omega*p.x)*t,a=omega*t,c=Math.cos(a),s=Math.sin(a)
  return {x:c*x-s*z,y:p.y+v.y*t,z:s*x+c*z}
}
export function metroMotionVolumes(motion: RegionalMotion) {
  const critical: Bounds3[]=[],prefetch: {bounds:Bounds3;deadline:number}[]=[]
  for(const body of motion.bodies){
    critical.push(box(body.position,metroCriticalRadius(body,motion)))
    let previous=body.position
    for(let step=1;step<=12;step++){
      const t=step*.25,next=metroCoast(body,motion.omega,t)
      // Whole swept segment plus bounded thrust, interpolation curvature and
      // grounded acceleration/instant walk input. No endpoint-only sampling.
      const uncertainty=.5*body.acceleration*t*t+(body.speedBound??0)*t
      const padding=METRO_CONTACT_MARGIN+body.radius+uncertainty+accelerationBound(body,motion.omega,t)*.25*.25/8
      prefetch.push({bounds:union(box(previous,padding),box(next,padding)),deadline:t})
      previous=next
    }
  }
  return {critical,prefetch}
}
