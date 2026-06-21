// One bottom strip that holds every flat-screen widget. Two clusters anchored to
// the bottom corners — left (menu + fullscreen + control/debug + status) and
// right (the right-hand actions: travel + spin + VR) — so the old scatter across
// the four screen edges collapses to the bottom. Each cluster may wrap to a
// second row (there is vertical room). The bar is click-through; only its pills
// capture input.

export type DockBarHandle = {
  left: HTMLElement
  right: HTMLElement
  setVisible: (visible: boolean) => void
  destroy: () => void
}

export const createDockBar = (options: { onMenu: () => void }): DockBarHandle => {
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

  // ☰ — the same config toggle as the Tab key, reachable on PC and touch alike.
  const hamburger = document.createElement('button')
  hamburger.className = 'dock-hamburger'
  hamburger.textContent = '☰'
  hamburger.setAttribute('aria-label', 'Menu')
  hamburger.title = 'Menu (Tab)'
  hamburger.addEventListener('pointerdown', (event) => event.stopPropagation())
  hamburger.addEventListener('click', (event) => {
    event.preventDefault()
    options.onMenu()
  })
  left.append(hamburger)

  document.body.append(root)

  return {
    left,
    right,
    setVisible: (visible: boolean) => {
      root.hidden = !visible
    },
    destroy: () => root.remove()
  }
}
