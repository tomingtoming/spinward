import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {createReadStream} from 'node:fs'
import {realpath,stat} from 'node:fs/promises'
const root=fileURLToPath(new URL('.',import.meta.url))
const evidence=process.env.PLATEAU_DATA_ROOT?process.env.PLATEAU_DATA_ROOT.replace(/\/$/,'')+'/':fileURLToPath(new URL('../webxr/evidence/plateau-transfer-20260922/',import.meta.url))
// Full bands keep one immutable data copy. Only the derived/public directory is
// served; raw source archives, receipts and the repository remain inaccessible.
const shared=process.env.PLATEAU_SHARE_DATA==='1'
const dataPlugin={name:'study-public-data',configurePreviewServer(server){
  if(!shared)return
  const directory=path.resolve(evidence,'derived')
  server.middlewares.use(async(req,res,next)=>{
    if(!['GET','HEAD'].includes(req.method))return next()
    try{
      const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname),candidate=path.resolve(directory,'.'+name)
      if(!candidate.startsWith(directory+path.sep))return next()
      const file=await realpath(candidate);if(!file.startsWith(directory+path.sep))return next()
      const info=await stat(file);if(!info.isFile())return next()
      res.setHeader('Content-Type',file.endsWith('.json')?'application/json; charset=utf-8':'application/octet-stream');res.setHeader('Content-Length',info.size);res.setHeader('Cache-Control','no-cache')
      if(req.method==='HEAD')return res.end()
      createReadStream(file).on('error',()=>res.destroy()).pipe(res)
    }catch{next()}
  })
}}
export default defineConfig({root,plugins:[dataPlugin],publicDir:evidence+'derived',build:{outDir:evidence+'viewer-dist',emptyOutDir:true,copyPublicDir:!shared},
  server:{host:'127.0.0.1',strictPort:true},preview:{host:'127.0.0.1',strictPort:true}})
