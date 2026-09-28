import {buildSync} from 'esbuild'
import {fileURLToPath} from 'node:url'
// Browser fixture uses this repository's exact Three version, independently
// of the minified production app. No production debug/export is required.
export const FRUSTUM_MODULE=buildSync({stdin:{contents:"import {Frustum} from 'three'; export const createFrustum=()=>new Frustum();",resolveDir:fileURLToPath(new URL('../..',import.meta.url))},bundle:true,format:'esm',write:false,minify:true}).outputFiles[0].text
