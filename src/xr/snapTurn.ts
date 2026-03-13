export type SnapTurnState = {
  armed: boolean
}

const SNAP_THRESHOLD = 0.7
const SNAP_RESET_THRESHOLD = 0.2

export const createSnapTurnState = (): SnapTurnState => ({
  armed: true
})

export const consumeSnapTurn = (axisX: number, state: SnapTurnState) => {
  if (!state.armed) {
    if (Math.abs(axisX) <= SNAP_RESET_THRESHOLD) {
      state.armed = true
    }

    return 0
  }

  if (Math.abs(axisX) < SNAP_THRESHOLD) {
    return 0
  }

  state.armed = false
  return Math.sign(axisX)
}
