import { expect, test } from 'bun:test'

import {
  BALL_COLLISION_GROUPS,
  BUILDING_COLLISION_GROUPS,
  CAR_COLLISION_GROUPS,
  PLAYER_COLLISION_GROUPS
} from './rapierBoundary'

// Rapier's interaction rule is a two-way AND: A and B collide iff
// (membershipsA & filterB) != 0 AND (membershipsB & filterA) != 0. Groups are
// packed as (memberships << 16) | filter.
const interact = (a: number, b: number) =>
  ((a >>> 16) & (b & 0xffff)) !== 0 && ((b >>> 16) & (a & 0xffff)) !== 0

test('streamed building colliders collide with the car and walker, never balls', () => {
  expect(interact(CAR_COLLISION_GROUPS, BUILDING_COLLISION_GROUPS)).toBe(true)
  expect(interact(PLAYER_COLLISION_GROUPS, BUILDING_COLLISION_GROUPS)).toBe(true)
  // The make-or-break: balls keep analytic building collision, so the solver
  // must IGNORE ball<->building or it double-resolves with the analytic path.
  // (Excluding the ball from the building filter is not enough on its own — the
  // ball must also set non-default groups, which is what this guards.)
  expect(interact(BALL_COLLISION_GROUPS, BUILDING_COLLISION_GROUPS)).toBe(false)
})

test('balls still collide with the car, the player and each other', () => {
  expect(interact(BALL_COLLISION_GROUPS, CAR_COLLISION_GROUPS)).toBe(true)
  expect(interact(BALL_COLLISION_GROUPS, PLAYER_COLLISION_GROUPS)).toBe(true)
  expect(interact(BALL_COLLISION_GROUPS, BALL_COLLISION_GROUPS)).toBe(true)
})

test('the driver never collides with the car they sit inside', () => {
  expect(interact(PLAYER_COLLISION_GROUPS, CAR_COLLISION_GROUPS)).toBe(false)
})
