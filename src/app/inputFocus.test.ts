import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { DesktopLookControls } from './desktopLookControls'
import { isGameplayKeyboardEvent, onInputInterrupted } from './inputFocus'

function withControls(run: (controls: DesktopLookControls, events: EventTarget, doc: EventTarget & { hidden: boolean }, element: EventTarget, camera: THREE.PerspectiveCamera, clicks: () => number) => void) {
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const events = new EventTarget(), doc = Object.assign(new EventTarget(), { hidden: false })
  const captured = new Set<number>()
  const element = Object.assign(new EventTarget(), {
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => captured.delete(id)
  })
  Object.defineProperty(globalThis, 'window', { value: events, configurable: true })
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true })
  const rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(); rig.add(camera)
  let clicks = 0
  const controls = new DesktopLookControls(rig, camera, element as unknown as HTMLElement, () => clicks++)
  try { run(controls, events, doc, element, camera, () => clicks) }
  finally {
    controls.dispose()
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow); else Reflect.deleteProperty(globalThis, 'window')
    if (savedDocument) Object.defineProperty(globalThis, 'document', savedDocument); else Reflect.deleteProperty(globalThis, 'document')
  }
}

function dispatch(target: EventTarget, type: string, properties: Record<string, unknown> = {}) {
  const event = new Event(type, { cancelable: true })
  for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value })
  target.dispatchEvent(event)
  return event
}

test('lost releases on blur and hidden pages stop walking, sprint and thrust; fresh input still works', () => {
  withControls((controls, events, doc) => {
    const press = (code: string) => dispatch(events, 'keydown', { code })
    press('KeyW'); press('ShiftLeft')
    expect(Math.abs(controls.update(.1, false).groundedTangent)).toBeGreaterThan(0)
    expect(controls.fastWalkHeld).toBe(true)
    dispatch(events, 'blur')
    expect(controls.update(.1, false).groundedTangent).toBe(0)
    expect(controls.fastWalkHeld).toBe(false)
    press('KeyW'); press('Space')
    expect(controls.update(.1, false, undefined, true).freeFlyThrust.length()).toBeGreaterThan(0)
    doc.hidden = true; dispatch(doc, 'visibilitychange')
    expect(controls.update(.1, false, undefined, true).freeFlyThrust.length()).toBe(0)
    doc.hidden = false; press('KeyW')
    expect(controls.update(.1, false, undefined, true).freeFlyThrust.length()).toBeGreaterThan(0)
    dispatch(events, 'pagehide')
    expect(controls.update(.1, false, undefined, true).freeFlyThrust.length()).toBe(0)
  })
})

test('interruption stops roll acceleration without destroying the existing free-flight angular momentum', () => {
  withControls((controls, events, _doc, _element, camera) => {
    controls.update(.1, false, undefined, true)
    dispatch(events, 'keydown', { code: 'KeyQ' })
    controls.update(.2, false, undefined, true)
    dispatch(events, 'blur')
    const start = camera.getWorldQuaternion(new THREE.Quaternion())
    controls.update(.2, false, undefined, true)
    const middle = camera.getWorldQuaternion(new THREE.Quaternion())
    controls.update(.2, false, undefined, true)
    const end = camera.getWorldQuaternion(new THREE.Quaternion())
    expect(start.angleTo(middle)).toBeGreaterThan(.01)
    expect(middle.angleTo(end)).toBeCloseTo(start.angleTo(middle), 6)
  })
})

test('cancelled or unmatched right pointer releases do not cycle a projectile or retain look drag', () => {
  withControls((_controls, events, _doc, element, camera, clicks) => {
    const pointer = { pointerId: 8, button: 2 }
    dispatch(element, 'pointerdown', pointer)
    dispatch(events, 'pointercancel', pointer)
    dispatch(events, 'pointerup', pointer)
    dispatch(events, 'pointermove', { ...pointer, movementX: 20, movementY: 10 })
    expect(clicks()).toBe(0)
    expect(camera.rotation.y).toBe(0)
    dispatch(element, 'pointerdown', pointer)
    dispatch(events, 'blur')
    dispatch(events, 'pointerup', pointer)
    expect(clicks()).toBe(0)
    dispatch(element, 'pointerdown', pointer)
    dispatch(events, 'pointerup', { ...pointer, pointerId: 9 })
    expect(clicks()).toBe(0)
    dispatch(events, 'pointerup', pointer)
    expect(clicks()).toBe(1)
  })
})

test('input and browser shortcuts retain their native keys while a clicked dock button does not trap movement', () => {
  const event = (code: string, target: object | null, properties = {}) => ({ code, target, ...properties }) as KeyboardEvent
  const field = { closest: (selector: string) => selector.includes('input') ? {} : null }
  const button = { closest: (selector: string) => selector.includes('button') ? {} : null }
  for (const code of ['KeyW', 'KeyR', 'KeyC', 'Digit4', 'Space', 'ArrowLeft']) expect(isGameplayKeyboardEvent(event(code, field))).toBe(false)
  for (const flag of ['ctrlKey', 'metaKey', 'altKey', 'isComposing']) expect(isGameplayKeyboardEvent(event('KeyR', null, { [flag]: true }))).toBe(false)
  expect(isGameplayKeyboardEvent(event('Space', button))).toBe(false)
  expect(isGameplayKeyboardEvent(event('Enter', button))).toBe(false)
  expect(isGameplayKeyboardEvent(event('KeyW', button))).toBe(true)
  expect(isGameplayKeyboardEvent(event('ArrowDown', button))).toBe(true)
})

test('focused fields cancel held input and disposed listeners do not retain their owner', () => {
  withControls((controls, events, doc) => {
    let calls = 0
    const remove = onInputInterrupted(() => calls++)
    dispatch(events, 'keydown', { code: 'KeyW' })
    dispatch(doc, 'focusin', { target: { closest: () => ({}) } })
    expect(controls.update(.1, false).groundedTangent).toBe(0)
    expect(calls).toBe(1)
    remove(); dispatch(events, 'blur')
    expect(calls).toBe(1)
  })
})


test('opening a UI panel cancels held walking intent until a fresh press', () => {
  withControls((controls, events) => {
    dispatch(events, 'keydown', { code: 'KeyW' })
    expect(Math.abs(controls.update(.1, false).groundedTangent)).toBeGreaterThan(0)
    dispatch(events, 'spinward-ui-open')
    expect(controls.update(.1, false).groundedTangent).toBe(0)
    expect(controls.update(.1, false).groundedTangent).toBe(0)
    dispatch(events, 'keydown', { code: 'KeyW' })
    expect(Math.abs(controls.update(.1, false).groundedTangent)).toBeGreaterThan(0)
  })
})
