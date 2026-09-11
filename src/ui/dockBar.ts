// One bottom strip that holds every flat-screen widget. Two clusters anchored to
// the bottom corners — left (fullscreen + control + status) and right (the
// right-hand actions: travel + spin + VR) — so the old scatter across the four
// screen edges collapses to the bottom. Each cluster may wrap to a second row
// (there is vertical room). The bar is click-through; only its pills capture
// input. Narrow screens keep the preset and Travel immediately available;
// secondary controls expand on demand instead of covering the player's feet.

import { closeEverything } from './dropdownLayer'

export type DockBarHandle = {
  // The bar's own root — mobileControls measures this to keep its button row
  // clear of however many rows the dock currently wraps to.
  root: HTMLElement
  left: HTMLElement
  right: HTMLElement
  setVisible: (visible: boolean) => void
  destroy: () => void
}

export const createDockBar = (): DockBarHandle => {
  const root = document.createElement('div')
  root.className = 'dock'

  const makeCluster = (modifier: 'left' | 'right') => {
    const el = document.createElement('div')
    el.className = `dock__cluster dock__${modifier}`
    root.append(el)
    return el
  }

  const left = makeCluster('left')
  const right = makeCluster('right')
  left.id = 'dock-status-controls'
  right.id = 'dock-world-controls'
  const more = document.createElement('button')
  more.className = 'dock-toggle dock-more'
  more.type = 'button'
  more.setAttribute('aria-controls', `${left.id} ${right.id}`)
  const expand = (expanded: boolean) => {
    root.classList.toggle('is-expanded', expanded)
    more.textContent = expanded ? 'Close' : 'More'
    more.setAttribute('aria-label', expanded ? 'Hide extra controls' : 'More controls')
    more.setAttribute('aria-expanded', String(expanded))
  }
  more.addEventListener('pointerdown', event => event.stopPropagation())
  more.addEventListener('click', event => {
    event.preventDefault()
    closeEverything()
    expand(!root.classList.contains('is-expanded'))
  })
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && root.classList.contains('is-expanded')) {
      const restoreFocus = root.contains(document.activeElement)
      closeEverything()
      expand(false)
      if (restoreFocus) more.focus()
    }
  }
  expand(false)
  root.append(more)
  document.addEventListener('keydown', onKey)

  document.body.append(root)

  return {
    root,
    left,
    right,
    setVisible: (visible: boolean) => {
      root.hidden = !visible
    },
    destroy: () => { document.removeEventListener('keydown', onKey); root.remove() }
  }
}
