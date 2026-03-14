export const DEFAULT_THROW_CHARGE_SECONDS = 1.2
export const DEFAULT_THROW_CHARGE_SPEED = 12

export const computeThrowChargeRatio = (
  heldSeconds: number,
  fullChargeSeconds = DEFAULT_THROW_CHARGE_SECONDS
) => {
  if (heldSeconds <= 0 || fullChargeSeconds <= 0) {
    return 0
  }

  return Math.min(heldSeconds / fullChargeSeconds, 1)
}

export const computeThrowChargeSpeed = (
  heldSeconds: number,
  speedScale: number,
  fullChargeSeconds = DEFAULT_THROW_CHARGE_SECONDS,
  maxChargeSpeed = DEFAULT_THROW_CHARGE_SPEED
) => {
  if (heldSeconds <= 0 || speedScale <= 0 || fullChargeSeconds <= 0 || maxChargeSpeed <= 0) {
    return 0
  }

  return maxChargeSpeed * speedScale * computeThrowChargeRatio(heldSeconds, fullChargeSeconds)
}
