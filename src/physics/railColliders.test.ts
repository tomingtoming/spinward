import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import catalog from '../worlds/generated/metroTransit.json'
import { metroRailData } from '../worlds/metroTransit'
import { RailService } from '../gameplay/railService'
import { RailColliders } from './railColliders'
import { initRapier } from './rapierContext'
import { applyWorldLengthUnit } from './rapierBoundary'
import { createUnitsContext, periodToOmega } from '../units/units'

// A car body streamed in beside a waiting walker must co-rotate from its first
// step. Created at the step's end pose it stood still in inertial space for one
// step and flung the walker ~45 m (Arakawa-shakomae island, 2026-09-30).
for (const stepped of [true, false]) test(`a newly streamed car co-rotates on its first step${stepped ? '' : ' (without the step angle)'}`, async () => {
  const asset = JSON.parse(readFileSync(new URL('../../public/assets/transit/three-band-tram.json', import.meta.url), 'utf8'))
  const study = { radius: catalog.radius, span: catalog.span, samples: catalog.frames.map(([id, band, frame]) => ({ id: id as string, band: band as number, frame })) }
  const data = metroRailData(study, asset)!, service = new RailService(data), train = service.trains[0]
  const rapier = await initRapier(), world = new rapier.World({ x: 0, y: 0, z: 0 }), units = createUnitsContext(.02)
  applyWorldLengthUnit(world, units)
  const omega = periodToOmega(113.5), dt = 1 / 60, frameAngle = .7
  const colliders = new RailColliders(rapier, world)
  try {
    colliders.configure(data, units)
    colliders.update(service, train.position[0] / 3200, train.position[1], frameAngle, units, null, stepped ? omega * dt : 0)
    world.timestep = dt; world.step()
    let speed = -1; world.bodies.forEach(b => { if (b.isKinematic()) { const v = b.linvel(); speed = units.toRealLength(Math.hypot(v.x, v.y, v.z)) } })
    const coRotation = omega * (3200 - train.position[2])
    if (stepped) expect(speed).toBeCloseTo(coRotation, 0)
    else expect(speed).toBeLessThan(1)
  } finally { colliders.dispose(); world.free() }
})
