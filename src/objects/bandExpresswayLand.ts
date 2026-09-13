import { expressStationAtAxial, type ExpressDesign, type ExpressRoute } from './bandExpressway'

/** Original colony transport proposal. Corridor/footprint dimensions are land
 * reservations, not road engineering standards or reconstructed anime plans. */
export function proposedBandExpressway():ExpressDesign {
  const main:ExpressRoute={id:'east-spine',name:'東縁本線',reservationWidth:120,waterBridges:[],
    points:[[1390,-19600],[1390,-12000],[1350,-4000],[1380,6500],[1350,13200],[1370,19600]]}
  const spur:ExpressRoute={id:'port-spur',name:'南端物流支線',reservationWidth:100,waterBridges:['river'],
    points:[[1020,-18800],[550,-19100],[-600,-19100]]}
  const station=(y:number)=>expressStationAtAxial(main,y)
  return {routes:[main,spur],junction:{id:'south-logistics-jct',name:'南部物流 JCT',main:main.id,station:station(-18100),branch:spur.id},
    interchanges:[
      {id:'south-terminal',name:'南端 IC',route:main.id,station:0,side:1,serves:['repair']},
      {id:'south-market-ic',name:'南部商業 IC',route:main.id,station:station(-11300),side:1,serves:['south-market','garden-housing']},
      {id:'central-ic',name:'中央 IC',route:main.id,station:station(-4400),side:1,serves:['campus']},
      {id:'arrival-ic',name:'到着地区 IC',route:main.id,station:station(1600),side:1,serves:['arrival','east-bank','old-town']},
      {id:'north-market-ic',name:'北部商業 IC',route:main.id,station:station(9700),side:1,serves:['north-market','park-centre']},
      {id:'north-terminal',name:'北端 IC',route:main.id,station:station(19600),side:1,serves:['north-port','north-housing']},
      {id:'port-terminal',name:'物流ゲート IC',route:spur.id,station:Math.hypot(470,300)+1150,side:1,serves:['south-port']}
    ],underpasses:[...[-14000,-7200,4700,13700].map((y,i)=>({id:`east-underpass-${i}`,route:main.id,station:station(y)})),
      {id:'logistics-underpass',route:spur.id,station:260}]}
}
