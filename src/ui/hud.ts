type HudSnapshot = {
  radius: number
  rpm: number
  gTarget: number
  ballCount: number
  trackedBallSpeed: number
  xrActive: boolean
  forceVectors: boolean
}

export type HudHandle = {
  destroy: () => void
  setVisible: (visible: boolean) => void
  update: (snapshot: HudSnapshot) => void
}

export const createHud = (): HudHandle => {
  const root = document.createElement('div')
  root.className = 'hud'

  const stats = document.createElement('div')
  stats.className = 'hud__stats'

  const controls = document.createElement('div')
  controls.className = 'hud__controls'
  controls.textContent =
    'VR: trigger=grab/spawn, both hands independent | PC: left click/Space=throw, right drag or arrow keys=look'

  root.append(stats, controls)
  document.body.append(root)

  return {
    destroy: () => root.remove(),
    setVisible: (visible: boolean) => {
      root.hidden = !visible
    },
    update: (snapshot) => {
      stats.textContent =
        `radius ${snapshot.radius.toFixed(0)}m | rpm ${snapshot.rpm.toFixed(1)} | ` +
        `g ${snapshot.gTarget.toFixed(2)}m/s^2 | balls ${snapshot.ballCount} | ` +
        `tracked speed ${snapshot.trackedBallSpeed.toFixed(2)}m/s | ` +
        `force vectors ${snapshot.forceVectors ? 'on' : 'off'} | ` +
        `${snapshot.xrActive ? 'XR' : 'desktop'}`
    }
  }
}
