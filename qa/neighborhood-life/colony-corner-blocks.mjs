import fs from 'node:fs/promises'
import { Matrix4, Quaternion, Vector3 } from 'three'

const plan=JSON.parse(await fs.readFile(new URL('../../assets/blender/izma-corner-blocks.json',import.meta.url),'utf8'))
const point=([x,y,h])=>new Vector3(Math.cos(x/3200)*(3200-h),y,Math.sin(x/3200)*(3200-h))
const pose=(at,look)=>{
  const q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(point(at),point(look),new Vector3(-Math.cos(at[0]/3200),0,-Math.sin(at[0]/3200))))
  return `m=f&rpm=0&p=${point(at).toArray()}&q=${q.toArray()}`
}
const views=[]
for(const district of [...new Set(plan.parcels.map(p=>p.district))]) {
  const p=plan.parcels.filter(p=>p.district===district).sort((a,b)=>b.area-a.area)[0]
  const centre=p.outline.reduce((r,p)=>[r[0]+p[0]/r[2],r[1]+p[1]/r[2],r[2]],[0,0,p.outline.length])
  const j=p.junction,dx=j[0]-centre[0],dy=j[1]-centre[1],n=Math.hypot(dx,dy)
  // At the market, retreating through the junction enters an opposite shop.
  // The saved junction centre remains on the road and sees both corner faces.
  const retreat=['c-market','b-station','c-production'].includes(district)?0:12
  const at=[j[0]+dx/n*retreat,j[1]+dy/n*retreat,p.floor+7]
  views.push([district+'-corner',pose(at,[centre[0],centre[1],p.floor+p.height*.45])])
  if(['a-old-town','b-station','c-market'].includes(district)) {
    views.push([district+'-corner-overview',pose([j[0]+dx/n*40,j[1]+dy/n*40,p.floor+55],[centre[0],centre[1],p.floor])])
  }
}
process.env.VIEWS ||= views.map(v=>v[0]).join(',')
process.env.SPINWARD_EXTRA_VIEWS=JSON.stringify(views)
await import('./colony-runtime.mjs')
