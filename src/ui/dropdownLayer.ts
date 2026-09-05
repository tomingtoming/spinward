// One dropdown layer shared by every pill that opens a small menu (the HUD's
// preset/projectile chips and the dock's Travel pill).
//
// Why a singleton: the dismissal model is a full-screen invisible backdrop —
// tapping *anywhere* outside closes whatever is open. Two independent
// backdrops would fight (the second one's would sit under the first's menu,
// and closing one would leave the other's registry stale), so the backdrop and
// the "close everything" registry have to be owned in one place.
//
// Everything opens and closes on pointerdown, never on click. While a menu is
// open the backdrop covers the chip that opened it, so the closing pointerdown
// lands on the backdrop — but the click completing that same tap then hits the
// chip (the backdrop is gone by pointerup) and would instantly reopen the
// menu. With no click handler on the chips at all, that race cannot happen.

let backdrop: HTMLElement | null = null
const closeFns = new Set<() => void>()

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
  if (backdrop !== null) {
    backdrop.hidden = true
  }
  for (const close of closeFns) {
    close()
  }
}

export const showBackdrop = () => {
  ensureBackdrop().hidden = false
}

export const hideBackdrop = () => {
  if (backdrop !== null) {
    backdrop.hidden = true
  }
}

export const registerClose = (close: () => void): (() => void) => {
  ensureBackdrop()
  closeFns.add(close)
  return () => closeFns.delete(close)
}

export type DropdownItem<T extends string> = { id: T; label: string }

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
  chip.className = className
  if (fixedLabel !== undefined) {
    chip.textContent = fixedLabel
  }

  const menu = document.createElement('div')
  menu.className = 'preset-menu'
  menu.hidden = true

  const close = () => {
    menu.hidden = true
    chip.classList.remove('is-active')
  }
  const unregister = registerClose(close)

  const menuItems = items.map(({ id, label }) => {
    const item = document.createElement('button')
    item.className = 'preset-menu__item'
    item.textContent = label
    item.addEventListener('pointerdown', (event) => event.stopPropagation())
    item.addEventListener('click', (event) => {
      event.preventDefault()
      closeEverything()
      onSelect(id)
    })
    menu.append(item)
    return { id, element: item }
  })

  chip.addEventListener('pointerdown', (event) => {
    event.stopPropagation()
    event.preventDefault()

    if (!menu.hidden) {
      // Unreachable while the backdrop is up (it covers the chip); kept as a
      // safety net so a stacking regression degrades to a working toggle.
      closeEverything()
      return
    }

    closeEverything()
    // Anchored to the chip's live position rather than a fixed offset — the
    // clusters' widths vary with which pills are visible.
    const rect = chip.getBoundingClientRect()
    menu.style.left = `${rect.left}px`
    menu.style.bottom = `${window.innerHeight - rect.top + 8}px`
    menu.hidden = false
    chip.classList.add('is-active')
    showBackdrop()
  })

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
      menu.remove()
    }
  }
}
