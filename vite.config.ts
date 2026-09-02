import { execSync } from 'node:child_process'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vite'

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
  plugins: [basicSsl()],
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
