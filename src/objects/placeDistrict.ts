import type { CityPlan, CityRoad, CityBuilding } from './cityLayout'
import type { NativeDistrict, DistrictTrafficStreet } from './nativeDistricts'
import { sampleStreetPath, streetPathSamples, type StreetPath } from './streetPath'
import type { StreetPolygon } from './streetPolygon'

const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a))

/** A park is reserved before streets or lots. Only the external ports inherit
 * the old city. Internally there is one bypass, one park-side circuit and
 * terminating branches, rather than a deformed row/column intersection grid. */
export function appendPlaceDistrict(city:CityPlan,roads:CityRoad[],buildings:CityBuilding[],radius:number){
  const original=city.roads,main=original.find(r=>r.kind==='arterial'&&r.axialLength>30000&&Math.abs(r.azimuth)<.01)
  if(!main)return null
  const azimuth=main.azimuth,vertical=original.filter(r=>r.axialLength>30000).filter(r=>Math.abs(wrap(r.azimuth-azimuth))*radius<600).sort((a,b)=>a.azimuth-b.azimuth)
  const centre=vertical.indexOf(main),west=vertical[centre-2],east=vertical[centre+2]
  const cross=original.filter(r=>r.tangentWidth>2500&&Math.abs(wrap(r.azimuth-azimuth))<.01&&r.axial>11800&&r.axial<13200).sort((a,b)=>a.axial-b.axial)
  if(!west||!east||cross.length!==5)return null
  const left=wrap(west.azimuth-azimuth)*radius,right=wrap(east.azimuth-azimuth)*radius,bottom=cross[0].axial,top=cross[4].axial
  const axial=(bottom+top)/2,width=right-left,length=top-bottom,id='district-park'
  const green:StreetPolygon=Array.from({length:24},(_,i)=>({x:125*Math.cos(i*Math.PI/12),y:295*Math.sin(i*Math.PI/12),u:0,v:0}))
  const d:NativeDistrict={id,band:0,character:'mixed',layout:'place-led',azimuth,axial,width,length,streets:[],buildings:[],replacedBuildings:0,replacedRoads:0,reserves:[green]}
  const inside=(p:{azimuth:number;axial:number})=>Math.abs(wrap(p.azimuth-azimuth))*radius<width/2-.01&&p.axial>bottom+.01&&p.axial<top-.01
  d.replacedBuildings=buildings.filter(inside).length
  const kept:CityRoad[]=[],ports:{road:CityRoad;point:[number,number];tangent:[number,number]}[]=[]
  for(const r of roads){
    const vertical=r.axialLength>r.tangentWidth,x=wrap(r.azimuth-azimuth)*radius
    const at=vertical?x:r.axial,lo=vertical?left:bottom,hi=vertical?right:top
    if(at<=lo+.01||at>=hi-.01){kept.push(r);continue}
    const mid=vertical?r.axial:x,half=(vertical?r.axialLength:r.tangentWidth)/2,a=vertical?bottom:left,b=vertical?top:right
    if(mid+half<=a+.01||mid-half>=b-.01){kept.push(r);continue}
    d.replacedRoads++
    for(const [side,start,end] of [[-1,mid-half,Math.min(mid+half,a)],[1,Math.max(mid-half,b),mid+half]]){
      if(end-start<.01)continue
      kept.push({...r,id:`${r.id}:${id}:${side}`,azimuth:vertical?r.azimuth:azimuth+(start+end)/(2*radius),axial:vertical?(start+end)/2:r.axial,tangentWidth:vertical?r.tangentWidth:end-start,axialLength:vertical?end-start:r.axialLength})
      if(r.id!==main.id&&!r.id?.startsWith(`${main.id}:`))ports.push({road:r,point:vertical?[x,(side<0?bottom:top)-axial]:[side<0?left:right,r.axial-axial],tangent:vertical?[0,-side]:[-side,0]})
    }
  }
  const make=(name:string,kind:CityRoad['kind'],w:number,points:[number,number][],tangents:[number,number][]):StreetPath=>({id:`${id}:${name}`,azimuth,axial,kind,width:w,level:0,groundHeight:0,walkHeight:.32,knots:points.map((point,i)=>({point,tangent:tangents[i]}))})
  const bypass=make('bypass','arterial',main.tangentWidth,[[0,-length/2],[-235,-420],[-280,0],[-220,420],[0,length/2]],[[0,270],[-130,350],[10,450],[160,350],[0,270]])
  // Junctions use actual sampled vertices of the bypass, not approximate hits.
  const south=sampleStreetPath(bypass,.25),north=sampleStreetPath(bypass,.75)
  const circuit=make('park-side','collector',12,[[south.x,south.y],[205,-250],[240,160],[north.x,north.y]],[[350,0],[160,300],[-160,350],[-350,0]])
  d.streets.push(bypass,circuit)
  const traffic:DistrictTrafficStreet={road:main,path:bypass,sourceRoadIds:[]}
  for(const [side,path]of [[-1,bypass],[1,circuit]] as const){
    const row=ports.filter(p=>Math.sign(p.point[0])===side).sort((a,b)=>a.point[1]-b.point[1])
    const samples=streetPathSamples(path)
    for(const [i,port]of row.entries()){
      const targetT=side<0?[.20,.36,.50,.64,.80][i]:[.12,.30,.50,.70,.90][i]
      if(targetT===undefined)throw Error('Unexpected external district ports')
      const target=samples.reduce((a,b)=>Math.abs(b.t-targetT)<Math.abs(a.t-targetT)?b:a)
      const dx=target.x-port.point[0],dy=target.y-port.point[1],distance=Math.hypot(dx,dy)
      let nx=-Math.sin(target.heading),ny=Math.cos(target.heading)
      if(nx*dx+ny*dy<0){nx=-nx;ny=-ny}
      d.streets.push(make(`branch-${side}-${i}`,port.road.kind,Math.min(port.road.tangentWidth,port.road.axialLength),[port.point,[target.x,target.y]],
        [[port.tangent[0]*distance*.75,port.tangent[1]*distance*.75],[nx*distance*.75,ny*distance*.75]]))
    }
  }
  city.patches=city.patches.filter(p=>!inside(p))
  city.trees=city.trees.filter(p=>!inside(p))
  city.patches.push({azimuth,axial,tangentExtent:130,axialExtent:340,kind:'park'})
  for(let i=0;i<24;i++){
    const a=i*Math.PI/12
    city.trees.push({azimuth:azimuth+(75+12*Math.sin(i*7))*Math.cos(a)/radius,axial:axial+(225+15*Math.cos(i*11))*Math.sin(a),height:6+i%4,tone:(i%7)/7})
  }
  city.intersections=city.intersections.filter(p=>!inside(p))
  return{district:d,roads:kept,buildings:buildings.filter(b=>!inside(b)),traffic}
}
