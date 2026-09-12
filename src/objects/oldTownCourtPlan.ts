import type { CityBuilding } from './cityLayout'
import type { OldTownPaving } from './oldTownBlockPlan'
import type { RoomSeat } from '../app/roomSeating'

export const COURT_GROUND = .12
export type CourtProp = { kind: 'chair' | 'table' | 'plant'; azimuth: number; axial: number; width: number; depth: number; height: number; tint: number }
export type CourtLifePlan = { props: CourtProp[]; seats: RoomSeat[]; colliders: CityBuilding[] }

/** Only furnish an already certified court. Retain its central street-to-door
 * corridor and a clear standing/exit area in front of the two seats. */
export function planOldTownCourtLife(paving: readonly OldTownPaving[], radius: number): CourtLifePlan {
  const result: CourtLifePlan = { props: [], seats: [], colliders: [] }
  const [court, path] = paving
  if (!court || !path || court.tangentWidth < 6 || court.axialLength < 8 ||
      Math.abs(path.azimuth - court.azimuth) * radius > .01 ||
      Math.abs(path.axial - path.axialLength / 2 - court.axial - court.axialLength / 2) > .01) return result
  const position = (x: number, y: number) => ({ azimuth: court.azimuth + x / radius, axial: court.axial + y })
  const x = -court.tangentWidth / 2 + 1.2, y = -court.axialLength / 2 + 2.6
  // Reject narrow courts instead of borrowing space from the existing 1.4m path.
  if (x + .6 + .23 > -Math.max(.7, path.tangentWidth / 2) - .5) return result
  for (const side of [-1, 1]) {
    const p = position(x + side * .6, y)
    result.props.push({ kind: 'chair', ...p, width: .46, depth: .38, height: .82, tint: side < 0 ? 0 : 1 })
    // The body rig places its pelvis .18m behind the eye/seat anchor.
    result.seats.push({ id: `old-town-court-${side}`, label: 'Courtyard chair', radius,
      azimuth: p.azimuth, axialPosition: p.axial + .18, groundHeight: COURT_GROUND, seatHeight: COURT_GROUND + .44,
      exit: { azimuth: p.azimuth, axialPosition: p.axial + 1.23 } })
  }
  result.props.push({ kind: 'table', ...position(x, y + .35), width: .32, depth: .3, height: .6, tint: 2 })
  for (const [i, [px, py, size, height]] of [
    [x - .6, y - 1.4, .48, 1.1],
    [court.tangentWidth / 2 - .8, -court.axialLength / 2 + 1, .6, 1.4],
    [court.tangentWidth / 2 - .95, -court.axialLength / 2 + 2.1, .4, .8],
  ].entries()) result.props.push({ kind: 'plant', ...position(px, py), width: size, depth: size, height, tint: i })
  for (const p of result.props) {
    const solid = (height: number, base: number, depth = p.depth, axial = p.axial) => result.colliders.push({
      azimuth: p.azimuth, axial, width: p.width, depth, height, baseHeight: COURT_GROUND + base,
      groundMargin: 0, collisionMargin: 0, kind: 'block', tone: .5,
    })
    if (p.kind === 'chair') {
      solid(.44, 0) // Seat and legs; top is the actual .44m seat surface.
      solid(.38, .44, .035, p.axial - .166) // Back remains behind the seated torso.
    } else solid(p.kind === 'plant' ? p.height * .4 : p.height, 0)
  }
  return result
}

export function oldTownCourtLod(distance: number, previous: number): 0 | 1 | 2 {
  if (distance > (previous < 2 ? 110 : 95)) return 2
  return distance < (previous === 0 ? 26 : 22) ? 0 : 1
}
