import { streetRibbon } from '../objects/streetPath'
import type { StreetNetwork } from '../objects/streetNetwork'
import type { StreetSegment } from '../objects/streetNetwork'

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
function contains(polygon:{x:number;y:number}[],px:number,py:number){
  let positive=false,negative=false
  for(let k=0;k<4;k++){
    const a=polygon[k],b=polygon[(k+1)%4],side=(b.x-a.x)*(py-a.y)-(b.y-a.y)*(px-a.x)
    if(side>1e-7)positive=true;if(side< -1e-7)negative=true
  }
  return !(positive&&negative)
}
export function isDrivingStreetPoint(network:StreetNetwork,azimuth:number,axial:number,clearance=1.1){
  return network.query(azimuth,axial,0,0).some(s=>{
    const polygon=roadPolygon(network,s,azimuth,axial,clearance)
    return polygon!==null&&contains(polygon,0,0)
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
      if(contains(polygon,px,py)){cost[j*nx+i]=1;heights[j*nx+i]=path.groundHeight}
    }
  }
  return heights
}
