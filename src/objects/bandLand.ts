import type { BandCentre, BandPoint, BandSite } from './bandStreetPlan'
import { bandLivingPlaces } from './bandLivingPlaces'
import { bandPublicPlaces } from './bandPublicPlaces'

/** An authored urban-planning proposal, not a reconstruction of an Izma map.
 * Physical strip bounds and independent land-use centres precede roads.
 * The existing river bridge is one retained anchor. New water reaches and
 * crossing candidates are provisional until terrain and transport review. */
export function proposedBandRiver(): BandPoint[] {
  return [
    [220,-20100],[-210,-17100],[320,-13500],[90,-10000],
    [520,-5800],[280,-1800],[650,-850],[500,350],[500,720],[564.244684642744,1445.8064516129052],
    [470,4100],[-120,7400],[240,10100],[80,13300],[-260,16900],[120,20100]
  ]
}

/** The reservation and elevation model use the same authored river alignment. */
export function bandRiverCentre(y:number,river=proposedBandRiver()) {
  if(!Number.isFinite(y)||y<river[0][1]||y>river.at(-1)![1])throw Error('Outside river alignment')
  const i=river.findIndex((p,j)=>j>0&&p[1]>=y),a=river[i-1],b=river[i]
  return a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1])
}

export function proposedBandLand(): BandSite {
  const river=proposedBandRiver(),bankX=(y:number)=>bandRiverCentre(y,river)
  const reserve=155 // water/bank envelope plus space for future road and sidewalk widths
  const water={id:'river',kind:'water' as const,polygon:[...river.map(([x,y])=>[x-reserve,y] as BandPoint),...[...river].reverse().map(([x,y])=>[x+reserve,y] as BandPoint)]}
  const centres: BandCentre[]=[
    {id:'south-port',point:[-600,-19500],use:'port',reach:850,demand:2},
    {id:'repair',point:[940,-17800],use:'industry',reach:1050,demand:2},
    {id:'south-market',point:[-820,-14800],use:'centre',reach:1450,demand:5},
    {id:'garden-housing',point:[930,-12200],use:'housing',reach:1650,demand:3},
    {id:'civic',point:[-970,-9150],use:'centre',reach:1650,demand:5},
    {id:'campus',point:[1030,-6820],use:'housing',reach:1450,demand:3},
    {id:'old-town',point:[-370,-3130],use:'centre',reach:1400,demand:5},
    {id:'arrival',point:[-70,0],use:'centre',reach:950,demand:3},
    {id:'east-bank',point:[1120,2520],use:'housing',reach:1550,demand:4},
    {id:'west-bank',point:[-1020,5310],use:'housing',reach:1300,demand:3},
    {id:'park-centre',point:[-690,8430],use:'centre',reach:1400,demand:4},
    {id:'north-market',point:[970,11070],use:'centre',reach:1800,demand:5},
    {id:'north-works',point:[-970,14300],use:'industry',reach:1200,demand:2},
    {id:'north-housing',point:[650,17150],use:'housing',reach:1250,demand:3},
    {id:'north-port',point:[-530,19500],use:'port',reach:800,demand:2}
  ]
  const living=bandLivingPlaces(),publicPlaces=bandPublicPlaces()
  return {id:'band-0-proposal',width:3200*Math.PI/3*.94,length:39840,seed:14092026,
    centres,reserves:[water,
      {id:'wetland',kind:'green',polygon:[[-1480,6300],[-620,6530],[-550,7390],[-1300,7730]]},
      {id:'service-campus',kind:'facility',polygon:[[-1450,-18300],[-720,-18200],[-650,-17500],[-1380,-17300]]},
      ...living.map(p=>p.reserve),...publicPlaces.filter(p=>!p.sharedReserve).map(p=>p.reserve)
    ],
    crossings:[-11200,1445.8064516129052,9300,16800].map((y,i)=>({id:i===1?'existing-river-bridge':`proposed-bridge-${i}`,reserve:'river',from:[bankX(y)-reserve,y],to:[bankX(y)+reserve,y]})),
    accesses:[...living.map(p=>p.access),...publicPlaces.flatMap(p=>p.accesses)],frontages:living.map(p=>p.frontage),localDemand:360,detourRatio:1.7}
}
