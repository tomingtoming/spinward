import {defineConfig} from '@playwright/test'
import base from './metro-main.playwright.config.mjs'
import {readFileSync} from 'node:fs'
import {X509Certificate,createHash} from 'node:crypto'
const certificate=new X509Certificate(readFileSync(new URL('../../node_modules/.vite/basic-ssl/_cert.pem',import.meta.url)))
const spki=createHash('sha256').update(certificate.publicKey.export({type:'spki',format:'der'})).digest('base64')
export default defineConfig({...base,testMatch:['metro-main.xr.mjs','metro-night.xr.mjs','metro-release.xr.mjs'],timeout:180000,
  use:{...base.use,launchOptions:{args:[`--ignore-certificate-errors-spki-list=${spki}`]}}})
