const textInputSelector = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]'

const isTextInput = (target: EventTarget | null) =>
  !!(target as Element | null)?.closest?.(textInputSelector)

/** Browser/editing shortcuts and native control activation belong to the UI.
 * Ordinary movement keys still work after clicking a dock button. */
export function isGameplayKeyboardEvent(event: KeyboardEvent) {
  if (typeof document !== 'undefined' && document.querySelector?.('.dropdown-backdrop:not([hidden])')) return false
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || isTextInput(event.target)) return false
  const control = (event.target as Element | null)?.closest?.('button, a[href], [role="button"], [role="menuitem"]')
  return !(control && ['Space', 'Enter'].includes(event.code))
}

/** A key/pointer release can be lost when the browser takes focus or suspends
 * a page. Cancel held intent, never the simulation's physical momentum. */
export function onInputInterrupted(cancel: () => void) {
  const visibility = () => { if (document.hidden) cancel() }
  const focus = (event: FocusEvent) => { if (isTextInput(event.target)) cancel() }
  window.addEventListener('spinward-ui-open', cancel)
  window.addEventListener('blur', cancel)
  window.addEventListener('pagehide', cancel)
  document.addEventListener('visibilitychange', visibility)
  document.addEventListener('focusin', focus)
  return () => {
    window.removeEventListener('spinward-ui-open', cancel)
    window.removeEventListener('blur', cancel)
    window.removeEventListener('pagehide', cancel)
    document.removeEventListener('visibilitychange', visibility)
    document.removeEventListener('focusin', focus)
  }
}
