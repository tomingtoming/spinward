import {defineConfig} from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {realpath,stat} from 'node:fs/promises'
import {createReadStream} from 'node:fs'

if(!process.env.SPINWARD_METRO_ROOT)throw Error('Set SPINWARD_METRO_ROOT to the acquired source work directory')
const root=path.resolve(process.env.SPINWARD_METRO_ROOT),directory=await realpath(path.join(root,'derived'))
const localHttp=process.env.SPINWARD_METRO_HTTP==='1'
function serve(server){server.middlewares.use(async(req,res,next)=>{
  if(!['GET','HEAD'].includes(req.method))return next()
  try{
    const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname),candidate=path.resolve(directory,'.'+name)
    if(!candidate.startsWith(directory+path.sep))return next()
    const file=await realpath(candidate);if(!file.startsWith(directory+path.sep))return next()
    const info=await stat(file);if(!info.isFile())return next()
    res.setHeader('Content-Type',file.endsWith('.json')?'application/json; charset=utf-8':file.endsWith('.png')?'image/png':'application/octet-stream')
    res.setHeader('Content-Length',info.size);res.setHeader('Cache-Control','no-cache')
    if(req.method==='HEAD')return res.end()
    createReadStream(file).on('error',()=>res.destroy()).pipe(res)
  }catch{next()}
})}
export default defineConfig({root:fileURLToPath(new URL('./metro/',import.meta.url)),publicDir:false,
  plugins:[...localHttp?[]:[basicSsl()],{name:'metro-derived-data',configureServer:serve,configurePreviewServer:serve}],
  build:{outDir:path.join(root,'viewer-dist'),emptyOutDir:true,copyPublicDir:false},
  server:{host:'127.0.0.1',https:localHttp?undefined:true,strictPort:true},preview:{host:'127.0.0.1',https:localHttp?undefined:true,strictPort:true}})
