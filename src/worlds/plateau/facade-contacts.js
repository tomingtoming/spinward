import {metroSurfaceLocation} from '../metroPlacement'

// Contact boxes come from the Blender kit's semantic primitives, never from
// the dense rendered sash/rail mesh. Their identities remain stable while a
// recipe is resident, so the physics cache can retain unchanged colliders.
export function facadeContactBoxes(parts,kit,band,radius){
  const result=[]
  for(const part of parts){
    const boxes=kit.parts[part.kind]?.collision;if(!boxes)continue
    boxes.forEach((box,i)=>{
      const x=box.center[0]+box.anchor*(part.width-1),y=box.center[1]*part.depth,z=part.origin[2]+box.center[2]
      const px=part.origin[0]+part.u[0]*x-part.u[1]*y,py=part.origin[1]+part.u[1]*x+part.u[0]*y
      result.push({key:`${band}:${part.id}:${part.origin.join(',')}:${i}`,kind:'block',tone:.5,
        ...metroSurfaceLocation(band,px,py,radius),width:box.size[0]+box.widthStretch*(part.width-1),
        depth:box.size[1]*part.depth,height:box.size[2],baseHeight:z-box.size[2]/2,
        yaw:Math.atan2(part.u[1],part.u[0]),groundMargin:0,collisionMargin:0})
    })
  }
  return result
}

export class FacadeContacts{
  constructor(radius){this.radius=radius;this.sources=new Map();this.signature='';this.parts=[];this.stats={candidates:0,active:0,truncated:0,selectionMs:0,changes:0}}
  update(layers,focus){
    const start=performance.now(),candidates=[]
    for(const layer of layers){
      const f=layer.facade,sites=[...layer.stream.entries.values()].filter(e=>e.status==='resident').map(e=>e.site.id)
      const key=f.sample.band,signature=f.revision+':'+sites.join(',');let cached=this.sources.get(key)
      if(cached?.signature!==signature){cached={signature,parts:facadeContactBoxes(sites.flatMap(id=>f.sites.get(id)?.parts??[]),f.kit,key,this.radius)};this.sources.set(key,cached)}
      for(const box of cached.parts){
        const dx=Math.atan2(Math.sin(box.azimuth-focus.azimuth),Math.cos(box.azimuth-focus.azimuth))*this.radius
        const distance=Math.hypot(dx,box.axial-focus.axial,Math.max(0,Math.abs(box.baseHeight+box.height/2-focus.altitude)-box.height/2))
        if(distance<60)candidates.push({box,distance})
      }
    }
    candidates.sort((a,b)=>a.distance-b.distance);this.stats.candidates=candidates.length;this.stats.truncated=Math.max(0,candidates.length-512)
    const chosen=candidates.slice(0,512).map(c=>c.box).sort((a,b)=>a.key.localeCompare(b.key)),signature=chosen.map(b=>b.key).join('|')
    const changed=signature!==this.signature
    if(changed){this.signature=signature;this.parts=chosen;this.stats.changes++}
    this.stats.active=chosen.length;this.stats.selectionMs=performance.now()-start
    return changed
  }
}
