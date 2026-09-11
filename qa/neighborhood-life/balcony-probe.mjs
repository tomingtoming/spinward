// Serialize into the page. Infer attachment and glazing alignment from live meshes,
// independently of the balcony planner, so a renderer/planner disagreement fails QA.
export function probeBalconies(){
 const c=window.__spinwardCity.colonyBuildings,owners=new Set(),counts={solid:0,rail:0};
 const entries=c.entries.filter(e=>e.visible&&!e.interior&&e.design.use.primary==='apartments');
 for(const [key,style] of [['balconies','solid'],['balconies-rail','rail']]){
  const mesh=c.batches.get(key);if(!mesh)continue;
  counts[style]=mesh.count;const data=mesh.instanceMatrix.array;
  for(let i=0;i<mesh.count;i++){
   const a=Array.from(data.slice(i*16,i*16+16)),width=Math.hypot(...a.slice(0,3)),height=Math.hypot(...a.slice(4,7)),depth=Math.hypot(...a.slice(8,11));
   if(Math.abs(height-1)>.0001||depth<.949||depth>1.151)throw Error('Non-metric balcony scale');
   const owner=entries.find(e=>{
    const m=e.matrix.elements,delta=a.slice(12,15).map((v,j)=>v-m[12+j]);
    const local=[0,4,8].map(k=>delta.reduce((s,v,j)=>s+v*m[k+j],0)),[x,y,z]=local;
    if([0,1,2].some(j=>Math.abs(a[4+j]-m[4+j])>.0001))return false;
    return e.parts.some(({volume:v,ground})=>{
     const upper=v.h-ground,floors=Math.max(1,Math.round(upper/e.design.profile.storey)),pitch=v.w/Math.max(1,Math.round(v.w/e.design.profile.bay));
     const nearInteger=n=>Math.abs(n-Math.round(n))<.002;
     if(Math.abs(z-(v.z+v.d/2-.04))>.002||Math.abs(x-v.x)+width/2>v.w/2+.002||y<3.399||y+1.07>=v.y+v.h/2)return false;
     if(!nearInteger((y-v.y+v.h/2-ground)*floors/upper)||!nearInteger((width+.16)/pitch)||!nearInteger((x-width/2-v.x+v.w/2-.08)/pitch))return false;
     if(style==='rail'&&Math.abs(width-(pitch-.16))>.002)return false;
     if(e.spec.volumes.some(o=>o!==v&&x+width/2>o.x-o.w/2+.003&&x-width/2<o.x+o.w/2-.003&&z+depth>o.z-o.d/2+.003&&z<o.z+o.d/2-.003&&y+1.07>o.y-o.h/2+.003&&y-.12<o.y+o.h/2-.003))throw Error('Balcony penetrates another building mass');
     return true;
    });
   });
   if(!owner)throw Error('Balcony is detached or misaligned with the glazing grid: '+key+'/'+i);
   owners.add(owner);
  }
 }
 if(owners.size>8||counts.solid+counts.rail>8*144||counts.solid+counts.rail!==c.group.userData.balconies)throw Error('Balcony budget mismatch');
 return {...counts,buildings:owners.size};
}
