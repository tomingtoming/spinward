import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

if (!process.env.SPINWARD_URL) throw Error('Set SPINWARD_URL to the running Spinward production preview URL.')
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '**/*.xr.mjs',
  outputDir: fileURLToPath(new URL('./artifacts', import.meta.url)),
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: process.env.SPINWARD_URL,
    channel: process.env.XR_BROWSER_CHANNEL ?? 'chrome',
    headless: true,
    viewport: { width: 1280, height: 960 },
    ignoreHTTPSErrors: true,
    locale: 'en-US',
    actionTimeout: 15_000,
    trace: 'retain-on-failure'
  }
})
