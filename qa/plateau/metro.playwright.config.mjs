import {defineConfig} from '@playwright/test'
import {fileURLToPath} from 'node:url'
if(!process.env.SPINWARD_METRO_URL||!process.env.SPINWARD_METRO_EVIDENCE)throw Error('Set the metro preview URL and evidence directory')
export default defineConfig({testDir:fileURLToPath(new URL('.',import.meta.url)),testMatch:'metro.xr.mjs',workers:1,retries:0,
  outputDir:process.env.SPINWARD_METRO_EVIDENCE,reporter:'list',timeout:180000,
  use:{baseURL:process.env.SPINWARD_METRO_URL,channel:'chrome',headless:true,viewport:{width:1600,height:1000},
       ignoreHTTPSErrors:true,locale:'ja-JP',trace:'retain-on-failure'}})
