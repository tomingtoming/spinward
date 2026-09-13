import { containsStreetPolygon } from '../objects/streetPolygon'
import { streetRibbon } from '../objects/streetPath'
import type { StreetNetwork } from '../objects/streetNetwork'
import type { StreetSegment } from '../objects/streetNetwork'
import type { CityPlan } from '../objects/cityLayout'
import { streetPathSurfaces } from '../objects/streetSurfacePlan'
import { getStreetProfile } from '../objects/streetProfile'

type Grid = { startAzimuth: number; startAxial: number; minX: number; minY: number; nx: number; ny: number; step: number; cost: Uint8Array }
function roadPolygon(network:StreetNetwork,s:StreetSegment,azimuth:number,axial:number,clearance:number){
  const path=network.streets[s.street],half=path.width/2-clearance
  if(path.level!==0||half<=0)return null
  const distanceStart=Math.max(s.distanceStart,network.closedEnds[s.street][0]?clearance:0)
  const distanceEnd=Math.min(s.distanceEnd,network.streetLengths[s.street]-(network.closedEnds[s.street][1]?clearance:0))
  if(distanceEnd<=distanceStart)return null
  const parameter=(d:number)=>s.start.t+(s.end.t-s.start.t)*(d-s.distanceStart)/(s.distanceEnd-s.distanceStart)
  const points=streetRibbon(path,parameter(distanceStart),parameter(distanceEnd),-half,half),radius=network.radius
  const centre=path.azimuth+(s.start.x+s.end.x)/(2*radius)
  const x=Math.atan2(Math.sin(centre-azimuth),Math.cos(centre-azimuth))*radius-(s.start.x+s.end.x)/2
  const polygon=points.map(p=>({x:x+p.x,y:path.axial-axial+p.y}))
  return polygon
}
export function isDrivingStreetPoint(network:StreetNetwork,azimuth:number,axial:number,clearance=1.1){
  return network.query(azimuth,axial,0,0).some(s=>{
    const polygon=roadPolygon(network,s,azimuth,axial,clearance)
    return polygon!==null&&containsStreetPolygon(polygon,0,0)
  })
}
/** Rasterise the same metric ribbons as the visible road. The bounded A*
 * search can therefore retain its obstacle/cell budget on an arbitrary street. */
export function paintDrivingStreets(network: StreetNetwork, grid: Grid, clearance = 1.1) {
  const {startAzimuth,startAxial,minX,minY,nx,ny,step,cost}=grid,radius=network.radius
  const width=(nx-1)*step,height=(ny-1)*step,heights=new Float32Array(cost.length)
  for(const s of network.query(startAzimuth+(minX+width/2)/radius,startAxial+minY+height/2,width,height)){
    const path=network.streets[s.street],polygon=roadPolygon(network,s,startAzimuth,startAxial,clearance)
    if(!polygon)continue
    // Closed road ends reserve the car's envelope; shared junctions keep their
    // full connection instead of leaving a gap between independently inset roads.
    const x0=Math.max(0,Math.ceil((Math.min(...polygon.map(p=>p.x))-minX)/step)),x1=Math.min(nx-1,Math.floor((Math.max(...polygon.map(p=>p.x))-minX)/step))
    const y0=Math.max(0,Math.ceil((Math.min(...polygon.map(p=>p.y))-minY)/step)),y1=Math.min(ny-1,Math.floor((Math.max(...polygon.map(p=>p.y))-minY)/step))
    for(let j=y0;j<=y1;j++)for(let i=x0;i<=x1;i++){
      const px=minX+i*step,py=minY+j*step
      if(containsStreetPolygon(polygon,px,py)){cost[j*nx+i]=1;heights[j*nx+i]=path.groundHeight}
    }
  }
  return heights
}

export function paintStreetPolygon(grid:Grid,polygon:{x:number;y:number}[],value:number){
  const {minX,minY,nx,ny,step,cost}=grid
  const x0=Math.max(0,Math.ceil((Math.min(...polygon.map(p=>p.x))-minX)/step)),x1=Math.min(nx-1,Math.floor((Math.max(...polygon.map(p=>p.x))-minX)/step))
  const y0=Math.max(0,Math.ceil((Math.min(...polygon.map(p=>p.y))-minY)/step)),y1=Math.min(ny-1,Math.floor((Math.max(...polygon.map(p=>p.y))-minY)/step))
  for(let j=y0;j<=y1;j++)for(let i=x0;i<=x1;i++)if(containsStreetPolygon(polygon,minX+i*step,minY+j*step))cost[j*nx+i]=value
}

/** Native district sidewalks and their actual zebra approaches participate in
 * the existing bounded foot search. No path may cut across a major road. */
export function paintDistrictFootways(plan:CityPlan,radius:number,grid:Grid){
  const cx=grid.startAzimuth+(grid.minX+(grid.nx-1)*grid.step/2)/radius,cy=grid.startAxial+grid.minY+(grid.ny-1)*grid.step/2
  const paths=plan.nativeDistricts?.filter(d=>Math.abs(Math.atan2(Math.sin(d.azimuth-cx),Math.cos(d.azimuth-cx)))*radius<d.width/2+grid.nx*grid.step/2+20&&Math.abs(d.axial-cy)<d.length/2+grid.ny*grid.step/2+20).flatMap(d=>d.streets)??[]
  if(!paths.length)return
  const relative=(source:{azimuth:number;axial:number},polygon:{x:number;y:number}[])=>{
    const x=Math.atan2(Math.sin(source.azimuth-grid.startAzimuth),Math.cos(source.azimuth-grid.startAzimuth))*radius
    return polygon.map(p=>({x:p.x+x,y:p.y+source.axial-grid.startAxial}))
  }
  for(const path of paths)for(const s of streetPathSurfaces(path,radius,true))paintStreetPolygon(grid,relative(path,s.polygon),1)
  for(const path of paths)for(const s of streetPathSurfaces(path,radius))paintStreetPolygon(grid,relative(path,s.polygon),path.kind==='local'?4:0)
  const range=Math.hypot(grid.nx,grid.ny)*grid.step
  // Restore major-road exclusion after every sidewalk/local ribbon, including
  // the old through road at a district edge. Reopen only real painted crossings.
  const graph=plan.streetNetwork
  if(graph)for(const s of graph.query(cx,cy,grid.nx*grid.step,grid.ny*grid.step)){
    const path=graph.streets[s.street]
    if(path.kind==='arterial'||path.kind==='collector')paintStreetPolygon(grid,relative(path,streetRibbon(path,s.start.t,s.end.t,-path.width/2,path.width/2)),0)
  }
  for(const c of plan.streetMarkings?.crossings(grid.startAzimuth,grid.startAxial,range)??[]){
    const half=c.source.width/2+getStreetProfile(c.source.kind,radius).sidewalk
    paintStreetPolygon(grid,relative(c.source,streetRibbon(c.source,c.start,c.end,-half,half)),3)
  }
}
