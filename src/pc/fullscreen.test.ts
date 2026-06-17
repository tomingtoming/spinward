import { describe, expect, test } from 'bun:test'

import {
  computeFullscreenButtonState,
  isFullscreenActive,
  isFullscreenSupported,
  toggleFullscreen
} from './fullscreen'

const spy = () => {
  const fn = (() => {
    fn.calls += 1
  }) as (() => void) & { calls: number }
  fn.calls = 0
  return fn
}

describe('isFullscreenSupported', () => {
  test('false when no document is available (e.g. SSR / tests)', () => {
    expect(isFullscreenSupported(undefined)).toBe(false)
  })

  test('false on iPhone Safari, which exposes no element fullscreen', () => {
    expect(isFullscreenSupported({} as Document)).toBe(false)
  })

  test('true via the standard API (desktop / Android Chrome)', () => {
    expect(isFullscreenSupported({ fullscreenEnabled: true } as Document)).toBe(true)
  })

  test('true via the webkit-prefixed fallback', () => {
    expect(
      isFullscreenSupported({ webkitFullscreenEnabled: true } as unknown as Document)
    ).toBe(true)
  })
})

describe('isFullscreenActive', () => {
  test('false when nothing is fullscreen', () => {
    expect(isFullscreenActive({} as Document)).toBe(false)
  })

  test('true when an element holds the standard fullscreen', () => {
    expect(
      isFullscreenActive({ fullscreenElement: {} as Element } as Document)
    ).toBe(true)
  })

  test('true via the webkit-prefixed element', () => {
    expect(
      isFullscreenActive({ webkitFullscreenElement: {} as Element } as unknown as Document)
    ).toBe(true)
  })
})

describe('computeFullscreenButtonState', () => {
  test('offers to enter fullscreen when inactive', () => {
    expect(computeFullscreenButtonState(false)).toEqual({
      pressed: false,
      title: 'Fullscreen'
    })
  })

  test('offers to exit fullscreen when active', () => {
    expect(computeFullscreenButtonState(true)).toEqual({
      pressed: true,
      title: 'Exit fullscreen'
    })
  })
})

describe('toggleFullscreen', () => {
  test('requests fullscreen on the element when nothing is active', () => {
    const request = spy()
    const exit = spy()
    toggleFullscreen(
      { requestFullscreen: request } as unknown as HTMLElement,
      { exitFullscreen: exit } as unknown as Document
    )
    expect(request.calls).toBe(1)
    expect(exit.calls).toBe(0)
  })

  test('falls back to the webkit request when standard is absent', () => {
    const webkitRequest = spy()
    toggleFullscreen(
      { webkitRequestFullscreen: webkitRequest } as unknown as HTMLElement,
      {} as Document
    )
    expect(webkitRequest.calls).toBe(1)
  })

  test('exits instead of requesting when an element is already fullscreen', () => {
    const request = spy()
    const exit = spy()
    toggleFullscreen(
      { requestFullscreen: request } as unknown as HTMLElement,
      { fullscreenElement: {}, exitFullscreen: exit } as unknown as Document
    )
    expect(exit.calls).toBe(1)
    expect(request.calls).toBe(0)
  })

  test('falls back to the webkit exit path', () => {
    const webkitExit = spy()
    toggleFullscreen(
      {} as unknown as HTMLElement,
      {
        webkitFullscreenElement: {},
        webkitExitFullscreen: webkitExit
      } as unknown as Document
    )
    expect(webkitExit.calls).toBe(1)
  })

  test('swallows a rejected request promise instead of throwing', () => {
    expect(() =>
      toggleFullscreen(
        { requestFullscreen: () => Promise.reject(new Error('denied')) } as unknown as HTMLElement,
        {} as Document
      )
    ).not.toThrow()
  })

  test('swallows a synchronous throw from the request', () => {
    expect(() =>
      toggleFullscreen(
        {
          requestFullscreen: () => {
            throw new Error('blocked')
          }
        } as unknown as HTMLElement,
        {} as Document
      )
    ).not.toThrow()
  })

  test('does nothing (no throw) when there is no document', () => {
    expect(() => toggleFullscreen(undefined, undefined)).not.toThrow()
  })
})
