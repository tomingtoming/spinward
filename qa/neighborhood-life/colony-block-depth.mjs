import fs from 'node:fs/promises'
import { Matrix4, Quaternion, Vector3 } from 'three'
// A saved contract keeps the camera sites unchanged for before/after images.
const plan=JSON.parse(await fs.readFile(process.env.SPINWARD_VIEW_PLAN??new URL('../../assets/blender/izma-neighbourhood-parcels.json',import.meta.url),'utf8'))
const point=([x,y,h])=>new Vector3(Math.cos(x/3200)*(3200-h),y,Math.sin(x/3200)*(3200-h))
const pose=(at,target,fly=false)=>{
 const q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(point([at[0],at[1],at[2]+1.8]),point(target),new Vector3(-Math.cos(at[0]/3200),0,-Math.sin(at[0]/3200))))
 return fly?`m=f&rpm=0&p=${point(at).toArray()}&q=${q.toArray()}`:`m=g&a=${at[0]/3200}&ax=${at[1]}&gh=${at[2]}&q=${q.toArray()}`
}
const views=[]
for(const district of plan.neighbourhoods){
 const candidates=plan.streets.filter(s=>s.district===district.id&&s.role==='back-lane')
 const street=candidates.sort((a,b)=>plan.parcels.filter(p=>p.route===b.id).length-plan.parcels.filter(p=>p.route===a.id).length)[0]??plan.streets.find(s=>s.district===district.id)
 const p=plan.parcels.find(p=>p.district===district.id),row=street?Math.floor(street.profile.length/3):0
 const at=street?street.profile[row]:p.access.start,target=street?street.profile[Math.min(street.profile.length-1,row+8)]:[at[0]+Math.cos(p.yaw)*40,at[1]+Math.sin(p.yaw)*40,at[2]]
 views.push([district.id+'-deep-lane',pose(at,[target[0],target[1],target[2]+1.8])])
 views.push([district.id+'-deep-overview',pose([at[0]+110,at[1]-135,at[2]+145],at,true)])
}
for(const [district,form,rear] of [['a-old-town','shop-with-setback-home',false],['a-old-town','house-with-rear-wing',true],['b-housing','courtyard-apartment',true],['b-housing','long-slab-apartment',false],['c-production','sawtooth-workshop',false]]){
 const p=plan.parcels.find(p=>p.district===district&&p.form===form)
 if(!p)throw Error('Missing inspection form '+district+'/'+form)
 const c=Math.cos(p.yaw),s=Math.sin(p.yaw),distance=p.size[1]/2+22,sign=rear?1:-1
 const at=[p.position[0]-s*distance*sign+c*8,p.position[1]+c*distance*sign+s*8,p.floor+p.size[2]+8]
 views.push([district+'-'+form,pose(at,[...p.position,p.floor+p.size[2]*.55],true)])
}
process.env.VIEWS ||= views.map(v=>v[0]).join(',')
process.env.SPINWARD_EXTRA_VIEWS=JSON.stringify(views)
await import('./colony-runtime.mjs')
