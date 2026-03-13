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
  ) {}

  start() {
    this.renderer.setAnimationLoop((time) => {
      const elapsedSeconds = time * 0.001
      const deltaSeconds =
        this.lastTimeSeconds === null
          ? 1 / 60
          : Math.min(0.05, elapsedSeconds - this.lastTimeSeconds)

      this.lastTimeSeconds = elapsedSeconds
      this.updateFrame({ deltaSeconds, elapsedSeconds })
    })
  }
}
