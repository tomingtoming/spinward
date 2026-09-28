import { expect, test } from 'bun:test'
import { landscapeColliders } from '../worlds/authoredLandscape'
import { buildCityCollisionIndex, getCityGroundHeight } from '../objects/cityLayout'
import { createPlayerTraversalState, disposePlayerTraversalState, resetPlayerToGrounded, stepGroundedPlayer, syncGroundedSurfaceFromPhysics } from '../app/playerTraversal'
import { createUnitsContext, periodToOmega } from '../units/units'
import { initRapier } from './rapierContext'
import { createRotatingCityColliders } from './rotatingCityColliders'
import { applyWorldLengthUnit } from './rapierBoundary'

// The upland entrance's rise and run, independently constructed as visible
// treads and vertical risers. Long pauses reproduce normal VR stick corrections.
for (const variableFrames of [false, true]) test(`a physical walker climbs normal stairs with long pauses${variableFrames ? ' and uneven frames' : ''}`, async () => {
  const radius = 3200, omega = periodToOmega(113.5), units = createUnitsContext(.02)
  const origin = [-528.85, 11458.23], direction = [.846233, -.532813], width = 4
  const top = 71.2514, bottom = 67.28607, count = 25, run = 7
  const point = (along: number, side: number, h: number) => [origin[0] + direction[0] * along - direction[1] * side,
    origin[1] + direction[1] * along + direction[0] * side, h]
  const vertices: number[] = []
  const quad = (a: number[], b: number[], c: number[], d: number[]) => vertices.push(...a, ...b, ...c, ...a, ...c, ...d)
  const tread = (a: number, b: number, h: number) => quad(point(a, -width / 2, h), point(b, -width / 2, h), point(b, width / 2, h), point(a, width / 2, h))
  tread(-2, 0, top); tread(run, run + 2, bottom)
  for (let i = 0; i < count; i++) {
    const a = i * run / count, b = (i + 1) * run / count, previous = top + (bottom - top) * i / count, h = top + (bottom - top) * (i + 1) / count
    tread(a, b, h)
    quad(point(a, -width / 2, previous), point(a, width / 2, previous), point(a, width / 2, h), point(a, -width / 2, h))
  }
  const xs = vertices.filter((_, i) => i % 3 === 0), ys = vertices.filter((_, i) => i % 3 === 1)
  const index = buildCityCollisionIndex(landscapeColliders({ solids: [], surfaces: [{ vertices,
    bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }] }, radius), radius, 40000)
  const rapier = await initRapier(), world = new rapier.World({ x: 0, y: 0, z: 0 })
  applyWorldLengthUnit(world, units)
  const city = createRotatingCityColliders(rapier, world, { radius, index, units, omega })
  const start = point(run + .6, 0, bottom), target = point(-.5, 0, top)
  const state = createPlayerTraversalState({ azimuth: start[0] / radius, axialPosition: start[1] }, radius, 0, omega, { rapier, world, units })
  resetPlayerToGrounded(state, { azimuth: start[0] / radius, axialPosition: start[1], radius, frameAngle: 0, omega, groundHeight: bottom })
  let time = 0, frame = 0, remaining = Infinity
  try {
    while (time < 70 && remaining > .3) {
      const dt = variableFrames ? [.011, .017, .028, .05][frame % 4] : 1 / 60
      world.timestep = dt
      const x = state.surface.azimuth * radius, y = state.surface.axialPosition
      const dx = target[0] - x, dy = target[1] - y
      remaining = Math.hypot(dx, dy)
      const speed = time < 1 || time % 1 > .2 ? 0 : Math.min(3.9, Math.max(1.2, remaining))
      city.update(state.surface.azimuth, y)
      stepGroundedPlayer(state, { radius, length: 40000, omega, frameAngleEnd: (time + dt) * omega, deltaSeconds: dt,
        tangentDistanceDelta: dx / Math.max(remaining, .001) * speed * dt, axisDistanceDelta: dy / Math.max(remaining, .001) * speed * dt,
        sampleGroundHeight: (a, y, h, tolerance) => getCityGroundHeight(index, radius, a, y, h, tolerance) })
      world.step(); syncGroundedSurfaceFromPhysics(state, (time + dt) * omega)
      if (state.mode !== 'grounded') break
      time += dt; frame++
    }
    expect(state.mode, JSON.stringify({ time, remaining, ground: state.groundHeight, surface: state.surface })).toBe('grounded')
    expect(remaining, `remaining ${remaining} m after ${time}s; foot height ${state.groundHeight}`).toBeLessThan(.3)
    expect(Math.abs(state.groundHeight - top)).toBeLessThan(.02)
  } finally { city.dispose(); disposePlayerTraversalState(state); world.free() }
})
