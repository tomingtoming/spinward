import fs from 'node:fs/promises'
import { Matrix4, Quaternion, Vector3 } from 'three'
const land = JSON.parse(await fs.readFile(new URL('../../assets/blender/izma-land-use.json', import.meta.url), 'utf8'))
const buildings = JSON.parse(await fs.readFile(new URL('../../assets/blender/izma-neighbourhood-parcels.json', import.meta.url), 'utf8')).parcels
const point = ([x,y,h]) => new Vector3(Math.cos(x/3200)*(3200-h),y,Math.sin(x/3200)*(3200-h))
const pose = (at, target, fly=false) => {
 const q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(point([at[0],at[1],at[2]+1.8]),point(target),new Vector3(-Math.cos(at[0]/3200),0,-Math.sin(at[0]/3200))))
 return fly ? `m=f&rpm=0&p=${point(at).toArray()}&q=${q.toArray()}` : `m=g&a=${at[0]/3200}&ax=${at[1]}&gh=${at[2]}&q=${q.toArray()}`
}
const views=[]
for(const district of [...new Set(land.zones.map(z=>z.district))]){
 const ordered=land.zones.filter(z=>z.district===district).sort((a,b)=>b.fixtures-a.fixtures),z=ordered.find(z=>z.access)??ordered[0]
 const centreXY=[z.outline.reduce((s,p)=>s+p[0],0)/z.outline.length,z.outline.reduce((s,p)=>s+p[1],0)/z.outline.length]
 const fallback=buildings.filter(p=>p.district===district).sort((a,b)=>Math.hypot(a.position[0]-centreXY[0],a.position[1]-centreXY[1])-Math.hypot(b.position[0]-centreXY[0],b.position[1]-centreXY[1]))[0]
 // Areas with rejected approaches still need visual coverage. Observe from
 // an existing street; the view does not invent a usable new entrance.
 const a=z.access?.profile[0]??fallback.access.start,b=z.access?.profile.at(-1)??[...centreXY,land.fixtures.find(f=>f.zone===z.id)?.position[2]??a[2]]
 views.push([district+'-land-entry',pose(a,[b[0],b[1],b[2]+1.8])])
 const centre=[...centreXY,b[2]]
 views.push([district+'-land-overview',pose([centre[0]+125,centre[1]-150,centre[2]+155],centre,true)])
}
process.env.VIEWS ||= views.map(v=>v[0]).join(',')
process.env.SPINWARD_EXTRA_VIEWS=JSON.stringify(views)
await import('./colony-runtime.mjs')
