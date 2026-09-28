// Reduce the actual shared facade recipe, rather than re-roll occupancy for
// the distant city. Run before prepare_metro_night.py. Output is an offline
// intermediate; no city-wide building-ID table is sent to the browser.
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {gunzipSync,gzipSync} from 'node:zlib'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {Color} from 'three'
import {composeBuildingFacades} from '../../src/worlds/plateau/facade-design.js'
import {collectBuildingLight} from '../../src/worlds/plateau/night-windows.js'
import {ROOM_MEAN_EXPOSURE} from '../../src/worlds/plateau/night-windows.js'
import {packTile} from '../../src/worlds/plateau/tile-format.js'

const args=process.argv.slice(2),option=k=>args[args.indexOf(k)+1]
if(!args.includes('--root')||!args.includes('--output'))throw Error('Explicit --root and --output required')
const root=path.resolve(option('--root')),output=path.resolve(option('--output'))
const catalog=args.includes('--catalog')?option('--catalog'):'stations-v6'
const paneName=args.includes('--panes')?option('--panes'):null,paneBands={}
const study=JSON.parse(await readFile(path.join(root,'derived/metro-overview.json'),'utf8'))
await mkdir(output,{recursive:true})
for(const sample of study.samples){
  const manifest=JSON.parse(await readFile(path.join(root,'derived',catalog,sample.id+'.json'),'utf8'))
  const rows=[],tiles=[],hash=createHash('sha256');let count=0,panes=0
  for(const site of manifest.sites){
    const raw=gunzipSync(await readFile(path.join(root,'derived',site.path)));hash.update(raw)
    const recipe=JSON.parse(raw),design=composeBuildingFacades(recipe.buildings,{life:true})
    if(paneName){
      const windows=design.parts.filter(p=>['window','glazing','entry'].includes(p.kind)&&p.light?.strength>0)
      const values=new Float32Array(windows.length*10)
      windows.forEach((p,i)=>values.set([...p.origin,...p.u,p.width,p.height,...new Color(p.light.colour).multiplyScalar(p.light.strength*ROOM_MEAN_EXPOSURE).toArray()],i*10))
      const bytes=packTile([{name:'night-panes',attributes:{instances:values}}]),compressed=gzipSync(bytes)
      const name=`${paneName}/${sample.id}/${site.id}.bin.gz`,filename=path.join(root,'derived',name)
      await mkdir(path.dirname(filename),{recursive:true});await writeFile(filename,compressed)
      tiles.push({id:site.id,path:name,bytes:compressed.length,decodedBytes:bytes.byteLength,sha256:createHash('sha256').update(bytes).digest('hex'),bounds:site.bounds,heightRange:site.heightRange,instances:windows.length})
    }
    for(const row of collectBuildingLight(recipe.buildings,design.parts,c=>new Color(c).toArray())){
      rows.push([row.id,...row.mean.map(c=>+c.toFixed(6))]);panes+=row.panes
    }
    if(++count%400===0)console.log(sample.id,count,'/',manifest.sites.length)
  }
  const data={version:1,band:sample.id,frame:sample.frame,catalog,recipeHash:hash.digest('hex'),buildings:rows,panes}
  await writeFile(path.join(output,sample.id+'-windows.json.gz'),gzipSync(JSON.stringify(data)))
  console.log(sample.id,'done',rows.length,'buildings',panes,'lit panes')
  paneBands[sample.id]=tiles
}
if(paneName)await writeFile(path.join(root,'derived',paneName,'manifest.json'),JSON.stringify({version:1,ready:true,frames:study.samples.map(s=>[s.id,s.band,s.frame]),bands:paneBands,maxBytes:8*1024*1024,maxResident:80,maxConcurrent:1}))
