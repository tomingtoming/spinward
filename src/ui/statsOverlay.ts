// Flat-screen perf readout for the on-device hunt: `?stats` pins the wrist
// watch's numbers (windowed fps, active depth mode, last-frame draws/tris) to
// a corner chip. Phones never see the VR watch, so this is what puts real
// numbers on the log↔plain A/B and the LOD budgets from a handset.
import type { DepthMode } from '../app/depthMode'
import type { PerfStats } from '../app/perfMeter'

export const isStatsOverlayRequested = (search: string): boolean =>
  new URLSearchParams(search).has('stats')

// One line, same vocabulary as the wrist perf line + RENDER card.
export const formatStatsLine = (
  stats: PerfStats,
  depthMode: DepthMode
): string => {
  const tris =
    stats.triangles >= 1e6
      ? `${(stats.triangles / 1e6).toFixed(1)}M`
      : `${Math.round(stats.triangles / 1e3)}k`

  return `${Math.round(stats.fps)} fps · ${depthMode.toUpperCase()} · ${stats.drawCalls} draws · ${tris} tris`
}

export type StatsOverlayHandle = {
  update: (deltaSeconds: number, stats: PerfStats, depthMode: DepthMode) => void
  destroy: () => void
}

// Draw calls and triangle counts wiggle every frame with culling; repainting
// the chip that often is churn without information. 4 Hz tracks the 0.5 s
// fps window comfortably.
const REFRESH_SECONDS = 0.25

export const createStatsOverlay = (mount: HTMLElement): StatsOverlayHandle => {
  const root = document.createElement('div')
  root.className = 'stats-overlay'
  mount.append(root)

  // Start past the refresh window so the very first update paints.
  let elapsed = REFRESH_SECONDS

  return {
    update: (deltaSeconds, stats, depthMode) => {
      elapsed += deltaSeconds
      if (elapsed < REFRESH_SECONDS) {
        return
      }
      elapsed = 0

      const line = formatStatsLine(stats, depthMode)
      if (root.textContent !== line) {
        root.textContent = line
      }
    },
    destroy: () => {
      root.remove()
    }
  }
}
