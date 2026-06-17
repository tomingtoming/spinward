// Fullscreen toggle, with the webkit-prefixed fallback some Safari builds
// still need. iPhone Safari exposes none of this (only <video> can go
// fullscreen), so isFullscreenSupported() is false there and the caller
// simply omits the button — the installed PWA is already fullscreen anyway.

type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
}

const activeDocument = (): FullscreenDocument | undefined =>
  typeof document === 'undefined' ? undefined : (document as FullscreenDocument)

export const isFullscreenSupported = (
  doc: FullscreenDocument | undefined = activeDocument()
): boolean => Boolean(doc && (doc.fullscreenEnabled || doc.webkitFullscreenEnabled))

export const isFullscreenActive = (
  doc: FullscreenDocument | undefined = activeDocument()
): boolean => Boolean(doc && (doc.fullscreenElement || doc.webkitFullscreenElement))

// The pressed/label state a toggle button should show for a given status.
// Pure so it can be unit-tested without a DOM.
export const computeFullscreenButtonState = (active: boolean) => ({
  pressed: active,
  title: active ? 'Exit fullscreen' : 'Fullscreen'
})

const requestFullscreen = (element: HTMLElement) => {
  const el = element as FullscreenElement
  return (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el)
}

const exitFullscreen = (doc: FullscreenDocument) =>
  (doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc)

// Enter or leave fullscreen, swallowing the rejection a browser raises when it
// denies the request outside a user gesture — an unhandled promise here would
// just spam the console without changing anything. The element/document are
// resolved only after the guard, so a no-arg call is safe where there is no DOM.
export const toggleFullscreen = (
  element?: HTMLElement,
  doc: FullscreenDocument | undefined = activeDocument()
): void => {
  if (doc === undefined) {
    return
  }

  const target = element ?? doc.documentElement

  try {
    const result = isFullscreenActive(doc) ? exitFullscreen(doc) : requestFullscreen(target)

    if (result instanceof Promise) {
      result.catch(() => {})
    }
  } catch {
    // Some Safari builds throw synchronously when the request is rejected.
  }
}

// Keep a toggle button's pressed state mirrored to the real fullscreen status:
// Esc and OS gestures change it without ever touching our button. Returns a
// disposer that detaches the listeners.
export const bindFullscreenButton = (button: HTMLElement): (() => void) => {
  const sync = () => {
    const { pressed, title } = computeFullscreenButtonState(isFullscreenActive())
    button.classList.toggle('is-active', pressed)
    button.setAttribute('aria-pressed', String(pressed))
    // Title is a hover tooltip (useless on touch); aria-label is the accessible
    // name for the icon-only button on every platform.
    button.setAttribute('aria-label', title)
    button.title = title
  }

  sync()
  document.addEventListener('fullscreenchange', sync)
  document.addEventListener('webkitfullscreenchange', sync)

  return () => {
    document.removeEventListener('fullscreenchange', sync)
    document.removeEventListener('webkitfullscreenchange', sync)
  }
}

// Standalone corner button for pointer devices (PC). Returns null when the
// platform can't go fullscreen, so the caller appends nothing.
export const createFullscreenToggle = (
  target: HTMLElement = document.documentElement
): { button: HTMLButtonElement; dispose: () => void } | null => {
  if (!isFullscreenSupported()) {
    return null
  }

  const button = document.createElement('button')
  button.className = 'fullscreen-toggle'
  button.textContent = '⛶'
  button.addEventListener('click', () => toggleFullscreen(target))
  // bindFullscreenButton owns the (state-aware) aria-label and pressed state.
  const unbind = bindFullscreenButton(button)

  return {
    button,
    dispose: () => {
      unbind()
      button.remove()
    }
  }
}
