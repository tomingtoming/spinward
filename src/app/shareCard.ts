import { getPresetById } from '../presets/presetManager'
import { rpmToOmega, surfaceG } from '../units/units'
import { decodeShareState } from './shareLink'

// The OGP card text for a share link: what an unfurl on X/Discord should say
// about THIS view, derived from the same codec the app boots from. Pure and
// dependency-light on purpose — the edge Worker imports it to rewrite the
// meta tags, and the numbers (felt g at the shared spot, habitat scale, hour)
// are computable from the URL alone.
//
// The image is still the static og.jpg for now; this module is the groundwork
// that a per-view image can later plug into (same inputs → an /og/... URL).

export type ShareCard = {
  title: string
  description: string
}

const EARTH_G = 9.81

const formatG = (omega: number, radialDistance: number) =>
  (surfaceG(omega, Math.max(0, radialDistance)) / EARTH_G).toFixed(2)

const formatRadius = (radius: number) =>
  radius >= 1000 ? `${(radius / 1000).toFixed(1)} km` : `${Math.round(radius)} m`

// Phase 0 = midnight, 0.5 = noon (see app/dayNight.ts).
const describeHour = (phase: number) => {
  if (phase < 0.2 || phase >= 0.85) {
    return 'at night'
  }

  if (phase < 0.35) {
    return 'in the morning'
  }

  if (phase < 0.6) {
    return 'at midday'
  }

  return 'at dusk'
}

// `search` is the raw URL query (location.search / URL#search).
export const buildShareCard = (search: string): ShareCard => {
  const params = new URLSearchParams(search)
  const presetId = params.get('preset') ?? 'izma'
  const preset = getPresetById(presetId) ?? getPresetById('izma')
  const state = decodeShareState(search)

  const name = preset?.name ?? 'Izma Colony'
  const radius = state.radius ?? preset?.real.radius_m ?? 3200
  const rpm = state.rpm ?? preset?.real.rpm ?? 5
  const omega = rpmToOmega(rpm)

  const title = `Spinward — ${name}`

  // No pose → the link is a habitat, not a view: keep the generic pitch.
  if (state.pose === null) {
    return {
      title,
      description:
        `Throw, jump, and float inside a spinning habitat — ` +
        `${formatRadius(radius)} radius at ${rpm.toFixed(2)} rpm. ` +
        'Held by the spin. Not by gravity.'
    }
  }

  const where =
    state.pose.mode === 'grounded'
      ? `Standing ${
          state.pose.groundHeight > 0.05
            ? `on a rooftop, ${Math.round(state.pose.groundHeight)} m up`
            : 'on the inner wall'
        }, feeling ${formatG(omega, radius - state.pose.groundHeight)} g`
      : (() => {
          const radial = Math.hypot(state.pose.position.x, state.pose.position.z)
          const altitude = Math.max(0, radius - radial)
          return radial > radius
            ? `Floating outside the hull, watching the whole colony turn`
            : `Floating ${Math.round(altitude)} m above the floor, feeling ${formatG(omega, radial)} g`
        })()

  const hour = state.dayNightPhase !== null ? ` ${describeHour(state.dayNightPhase)}` : ''
  const weather = state.raining ? ' It is raining — every drop lags the spin.' : ''

  return {
    title,
    description:
      `${where}${hour}, inside ${name} — a ${formatRadius(radius)}-radius habitat ` +
      `spinning at ${rpm.toFixed(2)} rpm.${weather} Held by the spin. Not by gravity.`
  }
}
