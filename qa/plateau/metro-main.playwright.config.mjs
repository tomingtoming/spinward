import {defineConfig} from '@playwright/test'
if(!process.env.SPINWARD_METRO_URL||!process.env.SPINWARD_METRO_EVIDENCE)throw Error('Set URL and evidence directory')
export default defineConfig({testDir:'.',testMatch:'metro-main.xr.mjs',outputDir:process.env.SPINWARD_METRO_EVIDENCE,
  workers:1,retries:0,timeout:120000,expect:{timeout:30000},reporter:'list',
  use:{baseURL:process.env.SPINWARD_METRO_URL,channel:'chrome',headless:true,viewport:{width:1280,height:960},locale:'en-US',trace:'retain-on-failure'}})
