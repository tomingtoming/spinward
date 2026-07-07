// Share links: the view someone is looking at, folded into a URL. Opening it
// boots the app at that exact spot — position, look direction, time of day,
// spin and weather — so a screenshot on X and "see it yourself" are one link
// apart. Pure encode/decode; main.ts owns applying the state.
//
// Params (all optional, composable with the existing ?preset= / ?rain):
//   m = g|f            grounded / free-fly
//   a = azimuth (rad)  grounded surface spot
//   ax = axial (m)
//   p = x,y,z          free-fly rotating-frame position (m)
//   q = x,y,z,w        camera world orientation (colony-fixed frame)
//   t = 0..1           day/night phase
//   rpm = number       spin override

export type SharePose =
  | { mode: 'grounded'; azimuth: number; axialPosition: number }
  | { mode: 'free-fly'; position: { x: number; y: number; z: number } }

export type ShareOrientation = { x: number; y: number; z: number; w: number }

export type ShareState = {
  pose: SharePose | null
  orientation: ShareOrientation | null
  dayNightPhase: number | null
  rpm: number | null
}

export type EncodeShareInput = {
  presetId: string | null
  rpm: number
  presetRpm: number | null
  dayNightPhase: number
  raining: boolean
  pose: SharePose
  orientation: ShareOrientation
}

const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

const finite = (value: number | null) =>
  value !== null && Number.isFinite(value) ? value : null

const parseNumber = (raw: string | null): number | null => {
  if (raw === null || raw.trim() === '') {
    return null
  }

  return finite(Number(raw))
}

const parseTuple = (raw: string | null, size: number): number[] | null => {
  if (raw === null) {
    return null
  }

  const parts = raw.split(',').map((part) => Number(part))

  if (parts.length !== size || parts.some((part) => !Number.isFinite(part))) {
    return null
  }

  return parts
}

export const encodeShareState = ({
  presetId,
  rpm,
  presetRpm,
  dayNightPhase,
  raining,
  pose,
  orientation
}: EncodeShareInput): string => {
  const params = new URLSearchParams()

  if (presetId !== null) {
    params.set('preset', presetId)
  }

  // Spin only when it diverges from the preset's own, so vanilla links stay
  // short and a later preset rebalance is not pinned by old URLs.
  if (presetRpm === null || Math.abs(rpm - presetRpm) > 1e-6) {
    params.set('rpm', String(round(rpm, 3)))
  }

  params.set('t', String(round(dayNightPhase, 3)))

  if (raining) {
    params.set('rain', '')
  }

  if (pose.mode === 'grounded') {
    params.set('m', 'g')
    params.set('a', String(round(pose.azimuth, 5)))
    params.set('ax', String(round(pose.axialPosition, 1)))
  } else {
    params.set('m', 'f')
    params.set(
      'p',
      [pose.position.x, pose.position.y, pose.position.z]
        .map((component) => String(round(component, 1)))
        .join(',')
    )
  }

  params.set(
    'q',
    [orientation.x, orientation.y, orientation.z, orientation.w]
      .map((component) => String(round(component, 4)))
      .join(',')
  )

  // URLSearchParams encodes the valueless rain flag as "rain="; trim it so the
  // flag reads the same as a hand-typed ?rain.
  return params.toString().replace(/rain=(?=&|$)/, 'rain')
}

// Tolerant: any malformed piece decodes to null and the app falls back to its
// normal boot for that piece, so a mangled pasted link still opens.
export const decodeShareState = (search: string): ShareState => {
  const params = new URLSearchParams(search)

  let pose: SharePose | null = null
  const mode = params.get('m')

  if (mode === 'g') {
    const azimuth = parseNumber(params.get('a'))
    const axialPosition = parseNumber(params.get('ax'))

    if (azimuth !== null && axialPosition !== null) {
      pose = { mode: 'grounded', azimuth, axialPosition }
    }
  } else if (mode === 'f') {
    const position = parseTuple(params.get('p'), 3)

    if (position !== null) {
      pose = {
        mode: 'free-fly',
        position: { x: position[0], y: position[1], z: position[2] }
      }
    }
  }

  let orientation: ShareOrientation | null = null
  const quaternion = parseTuple(params.get('q'), 4)

  if (quaternion !== null) {
    const [x, y, z, w] = quaternion
    const length = Math.hypot(x, y, z, w)

    // A zero/degenerate quaternion cannot be normalized into a view.
    if (length > 1e-3) {
      orientation = { x: x / length, y: y / length, z: z / length, w: w / length }
    }
  }

  const phase = parseNumber(params.get('t'))
  const rpm = parseNumber(params.get('rpm'))

  return {
    pose,
    orientation,
    dayNightPhase: phase !== null && phase >= 0 && phase <= 1 ? phase : null,
    rpm: rpm !== null && rpm >= 0 && rpm <= 12 ? rpm : null
  }
}
