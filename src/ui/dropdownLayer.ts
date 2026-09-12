// One dropdown layer shared by every pill that opens a small menu (the HUD's
// preset/projectile chips and the dock's Travel pill).
//
// Why a singleton: the dismissal model is a full-screen invisible backdrop —
// tapping *anywhere* outside closes whatever is open. Two independent
// backdrops would fight (the second one's would sit under the first's menu,
// and closing one would leave the other's registry stale), so the backdrop and
// the "close everything" registry have to be owned in one place.
//
// Pointer input opens and closes on pointerdown. While a menu is
// open the backdrop covers the chip that opened it, so the closing pointerdown
// lands on the backdrop — but the click completing that same tap then hits the
// chip (the backdrop is gone by pointerup) and would instantly reopen the
// menu. Only keyboard/assistive clicks (detail === 0) may open a chip on click.

let backdrop: HTMLElement | null = null
const closeFns = new Set<() => void>()
let nextDropdownId = 0

const ensureBackdrop = (): HTMLElement => {
  if (backdrop !== null) {
    return backdrop
  }

  const element = document.createElement('div')
  element.className = 'dropdown-backdrop'
  element.hidden = true
  element.addEventListener('pointerdown', (event) => {
    event.stopPropagation()
    closeEverything()
  })
  document.body.append(element)
  backdrop = element
  return element
}

export const closeEverything = () => {
  document.body.classList.remove('has-ui-popup')
  if (backdrop !== null) {
    backdrop.hidden = true
  }
  for (const close of closeFns) {
    close()
  }
}

export const showBackdrop = () => {
  document.body.classList.add('has-ui-popup')
  ensureBackdrop().hidden = false
}

export const registerClose = (close: () => void): (() => void) => {
  ensureBackdrop()
  closeFns.add(close)
  return () => closeFns.delete(close)
}

export type DropdownItem<T extends string> = { id: T; label: string; section?: string }

export type DropdownHandle<T extends string> = {
  chip: HTMLButtonElement
  menu: HTMLElement
  menuItems: { id: T; element: HTMLButtonElement }[]
  close: () => void
  destroy: () => void
}

// A tappable pill that opens a menu of choices anchored above it. Works
// identically on touch (tap to open, tap an item, tap the backdrop to dismiss
// without choosing) and with a mouse.
export const createDropdownChip = <T extends string>(
  className: string,
  items: readonly DropdownItem<T>[],
  onSelect: (id: T) => void,
  // When set, the chip keeps this label instead of showing the selection —
  // used by the dock's Travel pill, where the items are destinations to go to
  // rather than a current value.
  fixedLabel?: string
): DropdownHandle<T> => {
  const chip = document.createElement('button')
  chip.type = 'button'
  chip.id = `dropdown-chip-${++nextDropdownId}`
  chip.className = className
  if (fixedLabel !== undefined) {
    chip.textContent = fixedLabel
  }

  const menu = document.createElement('div')
  menu.id = `dropdown-menu-${nextDropdownId}`
  menu.className = 'preset-menu'
  menu.setAttribute('role', 'group')
  menu.setAttribute('aria-labelledby', chip.id)
  menu.hidden = true
  chip.setAttribute('aria-controls', menu.id)
  chip.setAttribute('aria-expanded', 'false')

  const close = () => {
    menu.hidden = true
    chip.classList.remove('is-active')
    chip.setAttribute('aria-expanded', 'false')
  }
  const unregister = registerClose(close)

  let previousSection: string | undefined
  const menuItems = items.map(({ id, label, section }) => {
    if (section && section !== previousSection) {
      const heading = document.createElement('div')
      heading.className = 'preset-menu__heading'
      heading.dataset.section = section
      heading.textContent = section
      menu.append(heading)
    }
    previousSection = section
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'preset-menu__item'
    item.textContent = label
    item.addEventListener('pointerdown', (event) => event.stopPropagation())
    item.addEventListener('click', (event) => {
      event.preventDefault()
      closeEverything()
      if (event.detail === 0) focusOwner().focus()
      onSelect(id)
    })
    menu.append(item)
    return { id, element: item }
  })

  const focusOwner = () => {
    const owner = chip.closest<HTMLElement>('[data-popup-owner]')?.dataset.popupOwner
    return owner ? document.getElementById(owner) ?? chip : chip
  }
  const availableItems = () => Array.from(menu.querySelectorAll<HTMLButtonElement>('button')).filter(el => !el.disabled && el.getClientRects().length > 0)
  const open = (keyboard = false, last = false) => {
    if (!menu.hidden) {
      // Unreachable while the backdrop is up (it covers the chip); kept as a
      // safety net so a stacking regression degrades to a working toggle.
      closeEverything()
      return
    }

    const rect = focusOwner().getBoundingClientRect()
    closeEverything()
    window.dispatchEvent(new Event('spinward-ui-open'))
    // Anchored to the chip's live position rather than a fixed offset — the
    // clusters' widths vary with which pills are visible.
    menu.style.left = `${rect.left}px`
    menu.style.bottom = `${window.innerHeight - rect.top + 8}px`
    menu.style.maxHeight = `${Math.max(80, rect.top - 16)}px`
    menu.hidden = false
    menu.scrollTop = 0
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.getBoundingClientRect().width - 8))}px`
    chip.classList.add('is-active')
    chip.setAttribute('aria-expanded', 'true')
    showBackdrop()
    if (keyboard) {
      const available = availableItems()
      ;(last ? available.at(-1) : available[0])?.focus()
    }
  }
  chip.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    open()
  })
  chip.addEventListener('click', (event) => {
    if (event.detail !== 0) return
    event.preventDefault()
    open(true)
  })
  chip.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault(); event.stopPropagation()
    open(true, event.key === 'ArrowUp')
  })
  menu.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    const available = availableItems(), index = available.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1
      : (index + (event.key === 'ArrowUp' ? -1 : 1) + available.length) % available.length
    available[next]?.focus()
  })
  const dismissKey = (event: KeyboardEvent) => {
    if (menu.hidden || event.key !== 'Escape') return
    event.preventDefault(); event.stopPropagation()
    closeEverything(); focusOwner().focus()
  }
  const dismissFocus = (event: FocusEvent) => {
    if (!menu.hidden && event.target !== chip && !menu.contains(event.target as Node)) closeEverything()
  }
  window.addEventListener('resize', closeEverything)
  document.addEventListener('keydown', dismissKey)
  document.addEventListener('focusin', dismissFocus)

  // Fixed-positioned above the bar (anchored dynamically to its chip), so the
  // menu lives on body rather than inside a display:contents wrapper.
  document.body.append(menu)

  return {
    chip,
    menu,
    menuItems,
    close,
    destroy: () => {
      unregister()
      window.removeEventListener('resize', closeEverything)
      chip.remove()
      document.removeEventListener('keydown', dismissKey)
      document.removeEventListener('focusin', dismissFocus)
      menu.remove()
    }
  }
}
