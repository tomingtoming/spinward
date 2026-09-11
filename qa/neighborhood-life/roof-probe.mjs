export function probeRoofs(target){
 const c=window.__spinwardCity.colonyBuildings,owners=new Set(),detailedOwners=new Set();let total=0,detailed=0,simple=0;
 const candidates=c.entries.filter(e=>e.visible&&e.roof&&e.roofLod<2);
 for(const key of ['roof-hvac','roof-vents','roof-simple']){
  const mesh=c.batches.get(key);if(!mesh)continue;
  if(key!=='roof-simple'&&mesh.count&&!mesh.geometry.getAttribute('color'))throw Error('Lost roof vertex colours');
  for(let i=0;i<mesh.count;i++){
   const m=mesh.instanceMatrix.array.slice(i*16,i*16+16),h=Math.hypot(...m.slice(4,7));
   const owner=candidates.find(e=>{
    const a=e.matrix.elements,v=e.roof,delta=m.slice(12,15).map((n,j)=>n-a[j+12]);
    const dot=k=>delta.reduce((n,x,j)=>n+x*a[k+j],0),x=dot(0),y=dot(4),z=dot(8);
    const span=k=>Math.abs(m.slice(0,3).reduce((n,x,j)=>n+x*a[k+j],0))+Math.abs(m.slice(8,11).reduce((n,x,j)=>n+x*a[k+j],0));
    const w=span(0),d=span(8),base=y-(key==='roof-simple'?h/2:0);
    if(Math.abs(base-v.y-v.h/2)>.003)return false;
    if(Math.abs(x-v.x)+w/2>v.w/2-.99||Math.abs(z-v.z)+d/2>v.d/2-.99)return false;
    if(Math.abs(x-v.x)<w/2+1.095&&Math.abs(z-v.z)<d/2+1.095)throw Error('Roof equipment obstructs beacon');
    return true;
   });
   if(!owner)throw Error('Floating/overhanging/unowned roof equipment');
   owners.add(owner);total++;
   if(key==='roof-simple')simple++;else{detailed++;detailedOwners.add(owner)}
  }
 }
 if(total!==c.group.userData.roofUnits||owners.size!==c.group.userData.roofBuildings||detailedOwners.size!==c.group.userData.roofDetailed)throw Error('Roof assembly clipped or miscounted');
 if(total>144||owners.size>24||detailedOwners.size>8||detailed>48)throw Error('Roof budget exceeded');
 const e=target&&c.entries.find(e=>e.spec.building.azimuth===target.azimuth&&e.spec.building.axial===target.axial);
 return {buildings:owners.size,detailedBuildings:detailedOwners.size,total,detailed,simple,...(e?{target:{level:e.roofLod,rendered:owners.has(e),detailed:detailedOwners.has(e)}}:{})};
}
