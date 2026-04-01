export type TrackableBall = {
  isGrabbed: boolean
}

export type DisposableBall<TGrabTarget = unknown> = TrackableBall & {
  grabTarget: TGrabTarget
  isExpired: () => boolean
  dispose: () => void
}

export const clearBalls = <TBall extends DisposableBall>(
  balls: TBall[],
  unregisterTarget: (grabTarget: TBall['grabTarget']) => void
) => {
  for (const ball of balls.splice(0)) {
    unregisterTarget(ball.grabTarget)
    ball.dispose()
  }
}

export const removeExpiredBalls = <TBall extends DisposableBall>(
  balls: TBall[],
  unregisterTarget: (grabTarget: TBall['grabTarget']) => void
) => {
  for (let index = balls.length - 1; index >= 0; index -= 1) {
    const ball = balls[index]

    if (!ball.isExpired()) {
      continue
    }

    unregisterTarget(ball.grabTarget)
    ball.dispose()
    balls.splice(index, 1)
  }
}

export const getTrackedBall = <TBall extends TrackableBall>(balls: TBall[]) => {
  for (let index = balls.length - 1; index >= 0; index -= 1) {
    const ball = balls[index]

    if (!ball.isGrabbed) {
      return ball
    }
  }

  return balls.at(-1) ?? null
}
