import type { CityBuilding, CityPlan, CityRoad } from './cityLayout'
import { getStreetProfile } from './streetProfile'
import type { ParkPath } from './publicPark'

export const UNDERPASS_HEIGHT = .34
export type PublicUnderpass = {
  azimuth: number
  axial: number
  length: number
  width: number
  roads: [CityRoad, CityRoad]
  paths: ParkPath[]
  rail: { x: number; y: number; length: number }
  benches: { x: number; y: number }[]
  lamps: { x: number; y: number }[]
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** One covered public link, on the side opposite the access ramps. Both ends
 * open into real avenue sidewalks; never lay paving across a carriageway or
 * turn a leftover patch beside the viaduct into a decorative dead end. */
export function planPublicUnderpass(plan: CityPlan, radius: number): PublicUnderpass | null {
  const ex = plan.expressway
  if (!ex || radius < 800 || ex.deckWidth < 19 || ex.deckHeight < 5) return null
  const axial = ex.axial - 6.5, width = 2.6
  const avenues = plan.roads.filter(r => r.axialLength > r.tangentWidth &&
    getStreetProfile(r.kind, radius).sidewalk >= 2 && Math.abs(wrap(r.azimuth)) * radius < 180 &&
    Math.abs(r.axial - axial) + width / 2 + 1 < r.axialLength / 2)
    .sort((a, b) => wrap(a.azimuth) - wrap(b.azimuth))
  const candidates: PublicUnderpass[] = []
  for (let i = 1; i < avenues.length; i++) {
    const left = avenues[i - 1], right = avenues[i]
    const lo = wrap(left.azimuth) * radius + left.tangentWidth / 2 + .15
    const hi = wrap(right.azimuth) * radius - right.tangentWidth / 2 - .15
    const length = hi - lo, azimuth = (lo + hi) / (2 * radius)
    if (length < 32 || length > 145) continue
    const benches = [-.22, .22].map(t => ({ x: t * length, y: -2 }))
    const paths: ParkPath[] = [{ x: 0, y: 0, width: length, depth: width },
      ...benches.map(p => ({ x: p.x, y: -2.05, width: 3.2, depth: 1.5 }))]
    const leftWalk = getStreetProfile(left.kind, radius).sidewalk
    const rightWalk = getStreetProfile(right.kind, radius).sidewalk
    // Stop the handrail beyond both avenue pavements, so pedestrians may turn
    // in either direction at either mouth without squeezing around an end post.
    const r0 = -length / 2 + leftWalk + .6, r1 = length / 2 - rightWalk - .6
    const rail = { x: (r0 + r1) / 2, y: width / 2 + .18, length: r1 - r0 }
    // A curb supports the rail feet and light posts outside the clear path.
    paths.push({ x: rail.x, y: rail.y, width: rail.length + .4, depth: .36 })
    // Test the whole paved region, including the sitting pockets. Conservative
    // original building envelopes also reserve their street-facing approaches.
    const overlaps = (p: ParkPath, a: number, ax: number, w: number, d: number, margin = 0) =>
      Math.abs(wrap(a - azimuth) * radius - p.x) < (p.width + w) / 2 + margin &&
      Math.abs(ax - axial - p.y) < (p.depth + d) / 2 + margin
    if (paths.some(p => plan.roads.some(r => overlaps(p, r.azimuth, r.axial, r.tangentWidth, r.axialLength)) ||
      plan.buildings.some(b => overlaps(p, b.azimuth, b.axial, b.width, b.depth, 1.5)) ||
      plan.trees.some(t => overlaps(p, t.azimuth, t.axial, 1.6, 1.6)))) continue
    const lampCount = Math.max(2, Math.ceil(rail.length / 24))
    const lamps = Array.from({ length: lampCount }, (_, n) => ({
      x: r0 + (n + .5) * rail.length / lampCount, y: rail.y
    }))
    candidates.push({ azimuth, axial, length, width, roads: [left, right], paths, rail, benches, lamps })
  }
  return candidates.sort((a, b) => Math.abs(wrap(a.azimuth)) - Math.abs(wrap(b.azimuth)))[0] ?? null
}

export function underpassGroundAndRail(plan: PublicUnderpass, radius: number): CityBuilding[] {
  const part = (x: number, y: number, width: number, depth: number, height: number, baseHeight = 0): CityBuilding => ({
    azimuth: plan.azimuth + x / radius, axial: plan.axial + y, width, depth, height, baseHeight,
    collisionMargin: 0, groundMargin: 0, tone: .5, kind: 'block'
  })
  const floors = plan.paths.slice(1).map(p => part(p.x, p.y, p.width, p.depth, UNDERPASS_HEIGHT))
  const rail = plan.rail
  // Short envelopes follow the curved path, matching the rendered panels and
  // streamed rigid-body boxes instead of a single hundred-metre tangent box.
  const count = Math.ceil(rail.length / 3), span = rail.length / count
  const barriers = Array.from({ length: count }, (_, i) =>
    part(rail.x - rail.length / 2 + (i + .5) * span, rail.y, span, .08, 1.08, UNDERPASS_HEIGHT))
  // The ground sampler uses radial rectangles; physics needs short boxes too.
  return [...underpassWalkSurfaces(plan,radius),...floors.flatMap(f => {
    const count = Math.ceil(f.width / 4), w = f.width / count
    return Array.from({ length: count }, (_, i) => ({ ...f, azimuth: f.azimuth + (-f.width / 2 + (i + .5) * w) / radius, width: w }))
  }), ...barriers]
}

/** Bevel the mouths of the raised walk down to the street's physical floor.
 * A 34 cm vertical face stops the dynamic 32 cm player sphere. Shared sloping
 * triangles let contact lift it, without moving the player or changing gravity. */
export function underpassWalkSurfaces(plan: PublicUnderpass, radius:number):CityBuilding[] {
  const half=plan.length/2, lip=.6, mouth=3.5, transition=5
  const xs=[...new Set([-half,-half+lip,-half+mouth,-half+transition,half-transition,half-mouth,half-lip,half,
    ...Array.from({length:Math.ceil(plan.length/3.2)+1},(_,i)=>-half+i*plan.length/Math.ceil(plan.length/3.2))])].sort((a,b)=>a-b)
  const ys=[-plan.width/2,-plan.width/2+.45,plan.width/2-.45,plan.width/2]
  const clamp=(v:number)=>Math.max(0,Math.min(1,v))
  const height=(x:number,y:number)=>{
    const end=half-Math.abs(x),side=clamp((plan.width/2-Math.abs(y))/.45),fade=clamp((end-mouth)/(transition-mouth))
    return UNDERPASS_HEIGHT*clamp(end/lip)*(side+(1-side)*fade)
  }
  const surfaces:CityBuilding[]=[]
  for(let i=1;i<xs.length;i++){
    const a=xs[i-1],b=xs[i];if(b-a<1e-7)continue
    const x=(a+b)/2,mesh:number[]=[]
    const point=(u:number,v:number)=>[u-x,v,height(u,v)]
    const quad=(a:number[],b:number[],c:number[],d:number[])=>mesh.push(...a,...b,...c,...a,...c,...d)
    for(let j=1;j<ys.length;j++)quad(point(a,ys[j-1]),point(b,ys[j-1]),point(b,ys[j]),point(a,ys[j]))
    for(const side of [-1,1]){
      const y=side*plan.width/2
      const corners=[point(a,y),[a-x,y,0],[b-x,y,0],point(b,y)]
      if(side>0)corners.reverse()
      quad(corners[0],corners[1],corners[2],corners[3])
    }
    // Omit zero-area faces at the tapered edge.
    const valid:number[]=[]
    for(let k=0;k<mesh.length;k+=9){const [ax,ay,ah,bx,by,bh,cx,cy,ch]=mesh.slice(k,k+9)
      if(Math.hypot((by-ay)*(ch-ah)-(bh-ah)*(cy-ay),(bh-ah)*(cx-ax)-(bx-ax)*(ch-ah),(bx-ax)*(cy-ay)-(by-ay)*(cx-ax))>1e-9)valid.push(...mesh.slice(k,k+9))}
    surfaces.push({azimuth:plan.azimuth+x/radius,axial:plan.axial,width:b-a,depth:plan.width,height:UNDERPASS_HEIGHT,
      baseHeight:0,groundSurface:true,groundMargin:0,collisionMargin:0,kind:'block',tone:.5,surfaceMesh:valid})
  }
  return surfaces
}
