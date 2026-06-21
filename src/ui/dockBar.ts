// One bottom row that holds every flat-screen widget. Three clusters —
// left (menu + control/debug + status), centre (travel + spin + VR), right
// (fullscreen) — so the old scatter across the four screen edges collapses into
// a single dock. The bar itself is click-through; only its pills capture input.

export type DockBarHandle = {
  left: HTMLElement
  center: HTMLElement
  right: HTMLElement
  setVisible: (visible: boolean) => void
  destroy: () => void
}

export const createDockBar = (options: { onMenu: () => void }): DockBarHandle => {
  const root = document.createElement('div')
  root.className = 'dock'

  const makeCluster = (modifier: 'left' | 'center' | 'right') => {
    const el = document.createElement('div')
    el.className = `dock__cluster dock__${modifier}`
    root.append(el)
    return el
  }

  const left = makeCluster('left')
  const center = makeCluster('center')
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
    center,
    right,
    setVisible: (visible: boolean) => {
      root.hidden = !visible
    },
    destroy: () => root.remove()
  }
}
