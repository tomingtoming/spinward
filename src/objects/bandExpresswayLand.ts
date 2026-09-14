import { expressStationAtAxial, type ExpressDesign, type ExpressRoute } from './bandExpressway'

/** Original colony transport proposal. Corridor/footprint dimensions are land
 * reservations, not road engineering standards or reconstructed anime plans. */
export function proposedBandExpressway(junctionLayout:'direct'|'split-level'='split-level'):ExpressDesign {
  const main:ExpressRoute={id:'east-spine',name:'東縁本線',reservationWidth:120,waterBridges:[],
    points:[[1390,-19600],[1390,-12000],[1350,-4000],[1380,6500],[1350,13200],[1370,19600]]}
  const spur:ExpressRoute={id:'port-spur',name:'南端物流支線',reservationWidth:100,waterBridges:['river'],
    points:[[1020,-18800],[550,-19100],[-600,-19100]]}
  if(junctionLayout==='split-level'){
    // A short west-facing stem gives all four JCT movements a common frame.
    // The S bend then rejoins the original river crossing and terminal gate.
    spur.points=[[850,-18100],...Array.from({length:25},(_,i)=>{
      const t=i/24,u=1-t
      return [u*u*u*820+3*u*u*t*570+3*u*t*t*800+t*t*t*550,-18100-1000*(3*u*t*t+t*t*t)] as [number,number]
    }),[-600,-19100]]
  }
  const station=(y:number)=>expressStationAtAxial(main,y)
  return {routes:[main,spur],junction:{id:'south-logistics-jct',name:'南部物流 JCT',main:main.id,station:station(-18100),branch:spur.id,layout:junctionLayout},
    interchanges:[
      {id:'south-terminal',name:'南端 IC',route:main.id,station:0,side:1,serves:['repair'],layout:'paired'},
      {id:'south-market-ic',name:'南部商業 IC',route:main.id,station:station(-11300),side:1,serves:['south-market','garden-housing'],layout:'diamond'},
      {id:'central-ic',name:'中央 IC',route:main.id,station:station(-4400),side:1,serves:['campus'],layout:'diamond'},
      {id:'arrival-ic',name:'到着地区 IC',route:main.id,station:station(1600),side:1,serves:['arrival','east-bank','old-town'],layout:'diamond'},
      {id:'north-market-ic',name:'北部商業 IC',route:main.id,station:station(9700),side:1,serves:['north-market','park-centre'],layout:'diamond'},
      {id:'north-terminal',name:'北端 IC',route:main.id,station:station(19600),side:1,serves:['north-port','north-housing'],layout:'paired'},
      {id:'port-terminal',name:'物流ゲート IC',route:spur.id,station:spur.points.slice(1).reduce((s,p,i)=>s+Math.hypot(p[0]-spur.points[i][0],p[1]-spur.points[i][1]),0),side:1,serves:['south-port'],layout:'paired'}
    ],underpasses:[...[-14000,-7200,4700,13700].map((y,i)=>({id:`east-underpass-${i}`,route:main.id,station:station(y)})),
      {id:'logistics-underpass',route:spur.id,station:260}]}
}
