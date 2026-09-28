import {defineConfig} from '@playwright/test'
import base from './metro-main.playwright.config.mjs'
export default defineConfig({...base,testMatch:'metro-facades.xr.mjs',timeout:150000})
