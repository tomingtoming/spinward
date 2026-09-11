export function probeStairs(){
 const city=window.__spinwardCity,c=city.colonyBuildings,r=c.radius,metal=c.batches.get('stair-metal'),flights=c.batches.get('stair-flights'),owners=new Map();
 const near=(a,b)=>Math.abs(a-b)<.002;
 const matrices=mesh=>Array.from({length:mesh?.count??0},(_,i)=>Array.from(mesh.instanceMatrix.array.slice(i*16,i*16+16)));
 const metalMatrices=matrices(metal),flightMatrices=matrices(flights);
 const size=m=>[Math.hypot(...m.slice(0,3)),Math.hypot(...m.slice(4,7)),Math.hypot(...m.slice(8,11))];
 const local=(m,e)=>{const a=e.matrix.elements,d=m.slice(12,15).map((v,i)=>v-a[12+i]);return [0,4,8].map(k=>d.reduce((n,v,i)=>n+v*a[k+i],0))};
 for(const e of c.entries){
  const s=c.stairwells.get(e.spec.building);if(!s||!e.visible)continue;
  const found=metalMatrices.some(m=>{const [w,h,d]=size(m),[x,y,z]=local(m,e);return !c.modules&&s.kind==='external'?near(w,6.4)&&near(d,2.8)&&near(h,s.levels.at(-1)+1.1)&&near(x,s.x-2.45)&&near(z,s.z-1.36)&&near(y,h/2):near(w,s.width)&&near(h,s.wall.h-.08)&&near(d,.2)&&near(x,s.x)&&near(y,s.wall.y)&&near(z,s.z-.09)});
  if(found)owners.set(e,s);
 }
 let expectedFlights=0,landings=0,external=0,enclosed=0;
 for(const [e,s] of owners){
  if(s.kind==='enclosed'){enclosed++;continue}external++;
  const cx=s.x-2.45,cz=s.z-1.36;
  const b=e.spec.building,t=b.front.axis==='tangent',side=b.front.side;
  const az=b.azimuth+side*(t?cz:-cx)/r,ax=b.axial+side*(t?cx:cz);
  if(!city.getBuildings().some(p=>Math.abs(p.azimuth-az)<1e-8&&near(p.axial,ax)&&near(p.width,t?2.8:6.4)&&near(p.depth,t?6.4:2.8)&&near(p.height,s.levels.at(-1)+1.1)))throw Error('Missing permanent stair envelope');
  if(!c.modules)continue;
  for(let i=1;i<s.levels.length;i++){
   const low=s.levels[i-1],high=s.levels[i],mid=(low+high)/2,rise=(high-low)/2;
   for(const [height,depth] of [[low,cz+.7],[mid,cz-.7]]){
    expectedFlights++;
    if(!flightMatrices.some(m=>{const [w,h,d]=size(m),[x,y,z]=local(m,e);return near(w,3.4)&&near(h,rise)&&near(d,1.15)&&near(x,cx)&&near(y,height)&&near(z,depth)}))throw Error('Missing/misaligned stair flight');
   }
   for(const [centerX,height] of [[cx-2.45,mid],[s.x,high]]){
    landings++;
    if(!metalMatrices.some(m=>{const [w,h,d]=size(m),[x,y,z]=local(m,e);return near(w,1.5)&&near(h,.13)&&near(d,2.7)&&near(x,centerX)&&near(y+.065,height)&&near(z,cz)}))throw Error('Landing does not meet flight');
   }
  }
 }
 if(external!==c.group.userData.stairBuildings||enclosed!==c.group.userData.enclosedStairs||flightMatrices.length!==expectedFlights)throw Error('Stair assembly truncated or ownership mismatch');
 if(external>4||enclosed>6||flightMatrices.length>96||(metal?.count??0)>4096)throw Error('Stair budget exceeded');
 return {external,enclosed,flights:flightMatrices.length,landings,metal:metal?.count??0};
}
