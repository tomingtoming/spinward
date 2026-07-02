// One bottom strip that holds every flat-screen widget. Two clusters anchored to
// the bottom corners — left (fullscreen + control + status) and right (the
// right-hand actions: travel + spin + VR) — so the old scatter across the four
// screen edges collapses to the bottom. Each cluster may wrap to a second row
// (there is vertical room). The bar is click-through; only its pills capture
// input.

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

  document.body.append(root)

  return {
    root,
    left,
    right,
    setVisible: (visible: boolean) => {
      root.hidden = !visible
    },
    destroy: () => root.remove()
  }
}
