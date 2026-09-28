import {defineConfig} from '@playwright/test'
import {fileURLToPath} from 'node:url'
if(!process.env.PLATEAU_STUDY_URL)throw Error('Set PLATEAU_STUDY_URL to this task’s preview URL.')
export default defineConfig({testDir:fileURLToPath(new URL('.',import.meta.url)),testMatch:'*.xr.mjs',workers:1,retries:0,timeout:120000,
  outputDir:process.env.PLATEAU_TEST_OUTPUT??fileURLToPath(new URL('../webxr/evidence/plateau-transfer-20260922/browser-tests',import.meta.url)),reporter:'list',
  use:{baseURL:process.env.PLATEAU_STUDY_URL,channel:'chrome',headless:true,viewport:{width:1600,height:1000},locale:'ja-JP',trace:'retain-on-failure'}})
