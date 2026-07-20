// Frame-rate and draw-stats sampler for the wrist panel. FPS is averaged over
// a short window so the readout holds still enough to read in VR; draw calls
// and triangles are the renderer's counters for the last completed frame.
export type PerfStats = {
  fps: number
  drawCalls: number
  triangles: number
}

export const createPerfMeter = (windowSeconds = 0.5) => {
  let frames = 0
  let elapsed = 0
  let fps = 0
  let drawCalls = 0
  let triangles = 0

  return {
    // Feed once per frame with the renderer's per-frame counters, read before
    // they are reset for the next frame.
    frame(deltaSeconds: number, render: { calls: number; triangles: number }) {
      drawCalls = render.calls
      triangles = render.triangles
      frames += 1
      elapsed += deltaSeconds

      if (elapsed >= windowSeconds) {
        fps = frames / elapsed
        frames = 0
        elapsed = 0
      }
    },
    stats(): PerfStats {
      return { fps, drawCalls, triangles }
    }
  }
}
