import { expect, test } from 'bun:test'

import { clearBalls, getTrackedBall, removeExpiredBalls } from './ballCollection'

test('getTrackedBall returns the most recent ungrabbed ball and falls back to the newest ball', () => {
  const first = { isGrabbed: true }
  const second = { isGrabbed: false }
  const third = { isGrabbed: true }

  expect(getTrackedBall([first, second, third])).toBe(second)
  expect(getTrackedBall([first, third])).toBe(third)
  expect(getTrackedBall([])).toBeNull()
})

test('removeExpiredBalls unregisters and disposes only expired balls', () => {
  const unregistered: string[] = []
  const disposed: string[] = []
  const balls = [
    {
      isGrabbed: false,
      grabTarget: 'a',
      isExpired: () => false,
      dispose: () => disposed.push('a')
    },
    {
      isGrabbed: false,
      grabTarget: 'b',
      isExpired: () => true,
      dispose: () => disposed.push('b')
    },
    {
      isGrabbed: true,
      grabTarget: 'c',
      isExpired: () => true,
      dispose: () => disposed.push('c')
    }
  ]

  removeExpiredBalls(balls, (target) => {
    unregistered.push(target)
  })

  expect(unregistered).toEqual(['c', 'b'])
  expect(disposed).toEqual(['c', 'b'])
  expect(balls.map((ball) => ball.grabTarget)).toEqual(['a'])
})

test('clearBalls unregisters and disposes every ball, then empties the collection', () => {
  const unregistered: string[] = []
  const disposed: string[] = []
  const balls = [
    {
      isGrabbed: false,
      grabTarget: 'a',
      isExpired: () => false,
      dispose: () => disposed.push('a')
    },
    {
      isGrabbed: false,
      grabTarget: 'b',
      isExpired: () => false,
      dispose: () => disposed.push('b')
    }
  ]

  clearBalls(balls, (target) => {
    unregistered.push(target)
  })

  expect(unregistered).toEqual(['a', 'b'])
  expect(disposed).toEqual(['a', 'b'])
  expect(balls).toEqual([])
})
