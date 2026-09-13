import { streetPathSamples, type StreetPath } from './streetPath'

/** Local streets divide large blocks with oblique T connections. Anchors use
 * existing adaptive sample vertices, so the rendered curve and graph share an
 * exact endpoint instead of an almost-touching point on a different chord. */
export function districtBlockLinks(streets:readonly StreetPath[],band:number,districtId=`district-${band}`,cells?:number):StreetPath[]{
 // Keep new connections in the middle of their block: bowed collectors still
 // need room for a complete crossing and stop line on every approach.
 const pairs=cells?[[0,.4/cells,1,.6/cells],[1,(Math.floor(cells/2)+.4)/cells,2,(Math.floor(cells/2)+.6)/cells],
  [0,(cells-1.6)/cells,1,(cells-1.4)/cells]]:[[0,.045,1,.125],[1,.395,2,.455],[0,.77,1,.715]]
 return pairs.map(([from,t0,to,t1],i)=>{
  const a=streets[from],b=streets[to]
  const anchor=(p:StreetPath,t:number)=>streetPathSamples(p).reduce((best,v)=>Math.abs(v.t-t)<Math.abs(best.t-t)?v:best)
  const start=anchor(a,t0),end=anchor(b,t1),dx=end.x-start.x,dy=end.y-start.y
  const bend=(i===1?-1:1)*(band===1?-1:1)*12,length=Math.hypot(dx,dy)
  const points:[number,number][]=[[start.x,start.y],[(start.x+end.x)/2-dy/length*bend,(start.y+end.y)/2+dx/length*bend],[end.x,end.y]]
  return{id:`${districtId}:link-${i}`,azimuth:a.azimuth,axial:a.axial,width:6,kind:'local',level:0,groundHeight:0,walkHeight:.32,
   knots:points.map((point,j)=>({point,tangent:j===1?[dx/2,dy/2]:j===0?[points[1][0]-point[0],points[1][1]-point[1]]:[point[0]-points[1][0],point[1]-points[1][1]]}))}
 })
}
