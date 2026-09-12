import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { ThrowTarget } from './throwTarget'
import { getThrowTargetLayout } from '../gameplay/throwTarget'
import { Ball } from './ball'
import { initRapier } from '../physics/rapierContext'
import { createUnitsContext } from '../units/units'

test.each([{ azimuth: 0, axial: 0 }, { azimuth: .052, axial: -360 }])('real throws still score after the practice lane moves: %o', async (origin) => {
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  // Only canvas painting is stubbed. The balls, frame transforms and goal
  // lifecycle use the same implementation as the application.
  const messages: string[] = []
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({ width: 0, height: 0, getContext: () => ({
      clearRect() {}, fillRect() {}, fillText(text: string) { messages.push(text) }
    }) })
  } })
  const parent = new THREE.Group()
  let hits = 0
  const target = new ThrowTarget(parent, () => { hits++ })
  const radius = 3200
  const omega = Math.sqrt(9.81 / radius)
  target.configure(radius, false, origin)
  const layout = getThrowTargetLayout(radius, origin)
  const units = createUnitsContext(0.02)
  let frameAngle = 0
  const shoot = (speed: number, degrees: number) => {
    const angle = degrees * Math.PI / 180
    const direction = new THREE.Vector3(-Math.cos(origin.azimuth) * Math.sin(angle), -Math.cos(angle), -Math.sin(origin.azimuth) * Math.sin(angle))
    const ball = new Ball({
      physics: { rapier, world, units, restitution: 0.4 },
      initialPosition: layout.start.clone().addScaledVector(direction, .35),
      maxTrailPoints: 8, lifetimeSeconds: 10, frameAngle, omega,
      onBounce: (bounced) => target.bounced(bounced)
    })
    try {
      const velocity = direction.clone().multiplyScalar(speed)
      ball.setVelocity(velocity)
      target.track(ball, velocity, omega)
      for (let frame = 0; frame < 360; frame++) {
        frameAngle += omega / 120
        world.timestep = 1 / 120
        world.step()
        ball.step({ deltaSeconds: 1 / 120, habitatRadius: radius,
          habitatLength: 40000, omega, frameAngleEnd: frameAngle, trailMode: 'rotating' })
        target.step([ball], 1 / 120)
      }
    } finally {
      ball.dispose()
    }
  }
  try {
    expect(target.hasHit).toBe(false)
    expect(target.getCard(layout.start, true)).toBe(target.getCard(layout.start, true))
    shoot(16, 0)
    expect(hits).toBe(0)
    expect(target.hasHit).toBe(false)
    shoot(16, 9)
    expect(hits).toBe(1)
    expect(target.hasHit).toBe(true)
    expect(target.getCard(layout.start, true)?.title).toBe('THROUGH!')
    expect(messages).not.toContain('THROUGH THE RING')
    expect(target.getCard(layout.start.clone().add(new THREE.Vector3(0, 30, 0)), true)).toBeNull()
    target.reset()
    expect(target.hasHit).toBe(true)
    shoot(12, 17)
    expect(hits).toBe(2)
  } finally {
    target.dispose()
    world.free()
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else Reflect.deleteProperty(globalThis, 'document')
  }
  expect(parent.children).toHaveLength(0)
})
