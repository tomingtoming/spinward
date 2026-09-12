import * as THREE from 'three'

export type FrameUpdate = {
  deltaSeconds: number
  elapsedSeconds: number
}

export class GameLoop {
  private lastTimeSeconds: number | null = null

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly updateFrame: (frame: FrameUpdate) => void
  ) {
    // XR timestamps may be predicted display times; the first window frame
    // after exit can be older. Never carry a physics step across clocks.
    const resetFrameClock = () => { this.lastTimeSeconds = null }
    renderer.xr.addEventListener('sessionstart', resetFrameClock)
    renderer.xr.addEventListener('sessionend', resetFrameClock)
  }

  start() {
    this.renderer.setAnimationLoop((time) => {
      const elapsedSeconds = time * 0.001
      const frameSeconds = this.lastTimeSeconds === null ? 0 : elapsedSeconds - this.lastTimeSeconds
      const deltaSeconds = frameSeconds > 0 ? Math.min(0.05, frameSeconds) : 1 / 60

      this.lastTimeSeconds = elapsedSeconds
      this.updateFrame({ deltaSeconds, elapsedSeconds })
    })
  }
}
