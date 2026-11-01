import { execSync } from 'node:child_process'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'

// Build id stamped into every metrics row (docs/metrics.md blob11) so a change
// in the funnel can be tied to the deploy that caused it. Workers Builds
// exposes the commit; a local build falls back to git; neither → 'dev'.
const buildId = (): string => {
  const ci = process.env.WORKERS_CI_COMMIT_SHA
  if (ci) return ci.slice(0, 12)
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim() || 'dev'
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  define: {
    __SPINWARD_BUILD__: JSON.stringify(buildId())
  },
  // The code and the tests import `@dimforge/rapier3d-compat` (its wasm is
  // base64 inside the JS, which bun test can load). The shipped bundle swaps
  // in the plain `@dimforge/rapier3d`, whose 1.5 MB wasm becomes a separate
  // cached asset instead of 2 MB of base64 in the main chunk (toming,
  // 2026-11-02). Same API; only `init()` differs (see physics/rapierContext).
  resolve: { alias: { '@dimforge/rapier3d-compat': '@dimforge/rapier3d' } },
  plugins: [basicSsl(), wasm()],
  // ESM wasm integration is top-level await; every target browser (Quest,
  // iOS 15+, desktop) has it.
  build: { target: 'esnext' },
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: true
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    https: true
  }
})
