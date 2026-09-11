/** Verify live GPU placements against permanent collision and cylinder gravity. */
export function probeForecourts(){
  const city=window.__spinwardCity,c=city.colonyBuildings,mesh=c.group.getObjectByName('colony-planters'),proxies=c.getForecourtColliders(),colliders=city.getBuildings();let checked=0;
  const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
  for(let i=0;i<mesh.count;i++){
   const m=mesh.instanceMatrix.array.slice(i*16,i*16+16),a=Math.atan2(m[14],m[12]),r=Math.hypot(m[12],m[14]);
   const p=proxies.find(p=>Math.abs(wrap(p.azimuth-a))*c.radius<.002&&Math.abs(p.axial-m[13])<.002);
   if(!p||Math.abs(r-(c.radius-p.baseHeight-p.height/2))>.002)throw Error('Planter detached from its ground/collision');
   if(!colliders.some(b=>b.azimuth===p.azimuth&&b.axial===p.axial&&b.baseHeight===p.baseHeight&&b.height===p.height&&b.width===p.width&&b.depth===p.depth))throw Error('Missing permanent planter collider');
   const up=[m[4],m[5],m[6]],height=Math.hypot(...up);
   if(Math.abs(up[0]/height+Math.cos(a))>.00001||Math.abs(up[1])>.00001||Math.abs(up[2]/height+Math.sin(a))>.00001)throw Error('Planter does not follow cylinder gravity');
   checked++;
  }
  if(mesh.count>320||mesh.count!==c.group.getObjectByName('colony-planting').count)throw Error('Forecourt detail budget/pair mismatch');
  return {planned:proxies.length,checked};
}
