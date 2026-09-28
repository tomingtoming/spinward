import {defineConfig,mergeConfig} from 'vite'
import base from '../../vite.config.ts'
import path from 'node:path'
import {realpath,stat} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {createGzip} from 'node:zlib'

if(!process.env.PLATEAU_DATA_ROOT||!process.env.SPINWARD_BANDS_OUTPUT)throw Error('Set explicit data and output directories')
const directory=await realpath(path.resolve(process.env.PLATEAU_DATA_ROOT,'derived'))
const publicRoot=await realpath(new URL('../../public/',import.meta.url))
const serve=(server)=>{server.middlewares.use(async(req,res,next)=>{
  if(!['GET','HEAD'].includes(req.method))return next()
  try{
    const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname)
    const root=name.startsWith('/assets/')||name.startsWith('/landscapes/')?publicRoot:directory
    const candidate=path.resolve(root,'.'+name)
    if(!candidate.startsWith(root+path.sep))return next()
    const file=await realpath(candidate)
    if(!file.startsWith(root+path.sep))return next()
    const info=await stat(file);if(!info.isFile())return next()
    const isJSON=file.endsWith('.json'),compressed=file.endsWith('.gz')
    res.setHeader('Content-Type',isJSON?'application/json; charset=utf-8':'application/octet-stream')
    res.setHeader('Cache-Control','no-cache');res.setHeader('Vary','Accept-Encoding')
    // The immutable source data stays shared. Streaming HTTP compression
    // avoids duplicating a 1.5 GB world or buffering it in server memory.
    const gzip=!compressed&&info.size>1024&&/\bgzip\b/.test(req.headers['accept-encoding']??'')
    if(gzip)res.setHeader('Content-Encoding','gzip');else res.setHeader('Content-Length',info.size)
    if(req.method==='HEAD')return res.end()
    const source=createReadStream(file);source.on('error',()=>res.destroy())
    if(gzip){const zip=createGzip({level:3});zip.on('error',()=>res.destroy());source.pipe(zip).pipe(res)}else source.pipe(res)
  }catch{next()}
})}

export default mergeConfig(base,defineConfig({
  plugins:[{name:'three-band-data',configureServer:serve,configurePreviewServer:serve}],
  build:{outDir:path.resolve(process.env.SPINWARD_BANDS_OUTPUT),emptyOutDir:true,copyPublicDir:false},
  // Serve existing public assets through a second confined root for the local
  // integration preview. Production packaging is intentionally a later step.
  server:{host:'127.0.0.1',strictPort:true},preview:{host:'127.0.0.1',strictPort:true},
}))
