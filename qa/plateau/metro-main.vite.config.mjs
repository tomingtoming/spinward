import {defineConfig} from 'vite'
import base from '../../vite.config.ts'
import path from 'node:path'
import {realpath,stat} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
if(!process.env.SPINWARD_METRO_ROOT||!process.env.SPINWARD_METRO_OUTPUT)throw Error('Set explicit Tokyo data and build output directories')
const dataRoot=await realpath(path.resolve(process.env.SPINWARD_METRO_ROOT,'derived'))
const publicRoot=await realpath(new URL('../../public/',import.meta.url))
const serve=server=>{server.middlewares.use(async(req,res,next)=>{
  // This local preview has no production analytics backend. Drain the beacon
  // without persisting or forwarding it, so the normal URL has no false 404.
  if(req.method==='POST'&&new URL(req.url,'http://localhost').pathname==='/metric'){
    req.resume();res.statusCode=204;res.setHeader('Cache-Control','no-store');return res.end()
  }
  if(!['GET','HEAD'].includes(req.method))return next()
  try{
    const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname)
    const root=name.startsWith('/assets/')||name.startsWith('/landscapes/')?publicRoot:dataRoot
    const candidate=path.resolve(root,'.'+name)
    if(!candidate.startsWith(root+path.sep))return next()
    const file=await realpath(candidate);if(!file.startsWith(root+path.sep))return next()
    const info=await stat(file);if(!info.isFile())return next()
    res.setHeader('Content-Type',file.endsWith('.json')?'application/json':file.endsWith('.png')?'image/png':'application/octet-stream')
    res.setHeader('Content-Length',info.size);res.setHeader('Cache-Control','no-cache')
    if(req.method==='HEAD')return res.end()
    createReadStream(file).on('error',()=>res.destroy()).pipe(res)
  }catch{next()}
})}
export default defineConfig({...base,publicDir:false,
  plugins:[{name:'tokyo-main-data',configureServer:serve,configurePreviewServer:serve}],
  build:{outDir:path.resolve(process.env.SPINWARD_METRO_OUTPUT),emptyOutDir:true,copyPublicDir:false},
  server:{host:'127.0.0.1',strictPort:true},preview:{host:'127.0.0.1',strictPort:true}})
