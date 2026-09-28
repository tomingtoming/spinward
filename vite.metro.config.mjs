// Production build: application/shared models only; the city lives on a CDN.
import {defineConfig} from 'vite'
import base from './vite.config.ts'
import path from 'node:path'
import {readFile} from 'node:fs/promises'

if(!process.env.SPINWARD_SHARED_PACKAGE||!process.env.SPINWARD_METRO_OUTPUT)throw Error('Set shared package and an explicit build output')
if(!/(?:^|\/)releases\/[a-f0-9]{64}\.json$/.test(process.env.VITE_METRO_RELEASE??''))throw Error('Pin VITE_METRO_RELEASE to one immutable data manifest')
if(!process.env.VITE_METRO_DATA_ROOT)throw Error('Set the data CDN root explicitly')
const sharedRoot=path.resolve(process.env.SPINWARD_SHARED_PACKAGE)
const shared=JSON.parse(await readFile(path.join(sharedRoot,'shared-index.json')))
export default defineConfig({...base,publicDir:path.join(sharedRoot,'public'),
  define:{...base.define,'import.meta.env.VITE_SHARED_ASSET_ROOT':JSON.stringify(shared.root)},
  build:{outDir:path.resolve(process.env.SPINWARD_METRO_OUTPUT),emptyOutDir:true,copyPublicDir:true,manifest:true}})
