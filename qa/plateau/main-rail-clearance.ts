import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { TerrainTriangles } from '../../src/worlds/plateau/band-landscape.js'
import { planBandRail } from '../../src/app/threeBands/transitPlan'
import { railPoint } from '../../src/gameplay/railService'

const root=process.env.PLATEAU_DATA_ROOT,output=process.env.SPINWARD_BANDS_OUTPUT
if(!root||!output)throw Error('Set input data root and evidence output directory')
const read=(p:string)=>JSON.parse(fs.readFileSync(path.join(root,'derived',p),'utf8'))
const study=read('study.json'),asset=JSON.parse(fs.readFileSync(new URL('../../public/assets/transit/three-band-tram.json',import.meta.url),'utf8'))
const terminals=study.samples.map((sample:any)=>({...read(sample.navigation).destinations.find((d:any)=>d.id==='outer-1-3'),sample,region:sample.id,label:sample.id}))
const terrains=study.samples.map((sample:any)=>{
  const d=read(sample.bandLandscape),m=d.meshes.find((m:any)=>m.name==='band-terrain')
  const p=fs.readFileSync(path.join(root,'derived',m.path,m.positions)),idx=fs.readFileSync(path.join(root,'derived',m.path,m.indices))
  const terrain=new TerrainTriangles(new Float32Array(p.buffer.slice(p.byteOffset,p.byteOffset+p.byteLength)),new Uint32Array(idx.buffer.slice(idx.byteOffset,idx.byteOffset+idx.byteLength)))
  return{sample,terrain}
})
const data=planBandRail(terminals,asset,(x,y)=>Math.max(...terrains.map(({sample,terrain}:any)=>terrain.height(x-sample.band*Math.PI*2/3*3200-sample.anchor.local[0],y-sample.anchor.local[1])).filter(Number.isFinite))),line=data.lines[0]
const maxGrade=Math.max(...line.points.slice(1).map((p,i)=>Math.abs(p[3]-line.points[i][3])/(p[0]-line.points[i][0])))
assert(maxGrade<=.030001,'Track exceeds its three-percent grade budget')
const report=terrains.map(({sample,terrain}:any)=>{
  let min=Infinity,at=null,checked=0
  for(let s=0;s<=line.length;s+=8)for(const lateral of [-3.15,0,3.15]){
    const q=railPoint(line,s,lateral),x=q[0]-sample.band*Math.PI*2/3*3200-sample.anchor.local[0],y=q[1]-sample.anchor.local[1],h=terrain.height(x,y)
    if(!Number.isFinite(h))continue
    checked++;if(q[2]+.05-h<min){min=q[2]+.05-h;at=[s,x,y,h]}
  }
  return{id:sample.id,minTrackClearanceM:min,at,checked}
})
fs.writeFileSync(path.join(output,'rail-terrain.json'),JSON.stringify(report,null,2))
fs.writeFileSync(path.join(output,'rail-profile.json'),JSON.stringify({lengthM:line.length,maxGrade,stations:data.stations},null,2))
console.log(report)
assert(report.every((r:any)=>r.checked>100&&r.minTrackClearanceM>.02),'Guideway is buried in a land strip')
