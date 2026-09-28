// Local HTTPS acceptance host. Only inventory-listed urban objects are served.
// It intentionally models opaque gzip objects and immutable browser caching.
import {defineConfig} from 'vite'
import base from '../../vite.metro.config.mjs'
import path from 'node:path'
import {readFile,realpath,stat} from 'node:fs/promises'
import {createReadStream} from 'node:fs'

if(!process.env.SPINWARD_RELEASE_PACKAGE||!process.env.SPINWARD_METRO_OUTPUT)throw Error('Set release package and build output')
const packageRoot=path.resolve(process.env.SPINWARD_RELEASE_PACKAGE)
const inventory=JSON.parse(await readFile(path.join(packageRoot,'inventory.json')))
const dataRoot=await realpath(path.join(packageRoot,'public'))
const publicRoot=await realpath(new URL('../../public/',import.meta.url))
const sharedRoot=process.env.SPINWARD_SHARED_PACKAGE&&path.resolve(process.env.SPINWARD_SHARED_PACKAGE)
const shared=sharedRoot?JSON.parse(await readFile(path.join(sharedRoot,'shared-index.json'))):null
const serve=server=>{server.middlewares.use(async(req,res,next)=>{
  const name=decodeURIComponent(new URL(req.url,'https://localhost').pathname)
  if(req.method==='POST'&&name==='/metric'){req.resume();res.statusCode=204;return res.end()}
  if(!['GET','HEAD'].includes(req.method))return next()
  const data=name.startsWith('/metro-data/')
  const key=data?name.slice('/metro-data/'.length):name.slice(1)
  const sharedKey=shared&&name.startsWith(shared.root+'/')?name.slice(shared.root.length+1):null
  const sharedEntry=sharedKey&&shared.objects[sharedKey]
  const entry=data?inventory.objects[key]:sharedEntry?{...sharedEntry,contentType:name.endsWith('.png')?'image/png':name.endsWith('.json')?'application/json':name.endsWith('.txt')?'text/plain':'model/gltf-binary',cacheControl:'public, max-age=31536000, immutable'}:null
  if(data&&!entry){res.statusCode=404;res.setHeader('Cache-Control','no-store');return res.end()}
  if(!data&&!sharedEntry&&(shared||!name.startsWith('/assets/')))return next()
  try{
    const root=data?dataRoot:sharedEntry?path.resolve(process.env.SPINWARD_METRO_OUTPUT):publicRoot,file=await realpath(path.resolve(root,key))
    if(!file.startsWith(root+path.sep))throw Error('Outside public assets')
    const info=await stat(file);if(!info.isFile())return next()
    res.setHeader('Content-Type',entry?.contentType??(file.endsWith('.png')?'image/png':'application/octet-stream'))
    res.setHeader('Content-Length',info.size)
    res.setHeader('Cache-Control',entry?.cacheControl??'public, max-age=3600')
    if(entry){
      res.setHeader('ETag',`"${entry.sha256}"`)
      res.setHeader('Access-Control-Allow-Origin','*')
      res.setHeader('Timing-Allow-Origin','*')
      if(req.headers['if-none-match']===`"${entry.sha256}"`){res.statusCode=304;return res.end()}
    }
    if(req.method==='HEAD')return res.end()
    createReadStream(file).on('error',()=>res.destroy()).pipe(res)
  }catch{if(data){res.statusCode=404;res.end()}else next()}
})}
export default defineConfig({...base,
  plugins:[...base.plugins,{name:'metro-immutable-release',configureServer:serve,configurePreviewServer:serve}],
  server:{host:'127.0.0.1',strictPort:true,https:{}},preview:{host:'127.0.0.1',strictPort:true,https:{}}})
