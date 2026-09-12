import { closeEverything, createDropdownChip } from './dropdownLayer'

export type DockBarHandle = {
  root: HTMLElement
  primary: HTMLElement
  status: HTMLElement
  left: HTMLElement
  right: HTMLElement
  equipment: HTMLElement
  driving: HTMLElement
  system: HTMLElement
  setVisible: (visible: boolean) => void
  destroy: () => void
}

/** A quiet permanent strip; secondary controls live in a scrollable menu.
 * Its popup is outside the strip so opening it never pushes touch controls up. */
export const createDockBar = (): DockBarHandle => {
  const root = document.createElement('nav')
  root.className = 'dock dock--quiet'
  root.setAttribute('aria-label', 'Colony controls')
  const status = document.createElement('div')
  status.className = 'dock__status'
  const primary = document.createElement('div')
  primary.className = 'dock__primary'
  const menu = createDropdownChip<never>('dock-menu-button', [], () => {}, 'Menu')
  menu.menu.classList.add('ui-panel', 'colony-menu')
  menu.menu.dataset.popupOwner = menu.chip.id
  const heading = document.createElement('h2')
  heading.textContent = 'Colony menu'
  menu.menu.append(heading)
  const section = (label: string) => {
    const wrapper = document.createElement('section')
    wrapper.className = 'ui-section'
    const title = document.createElement('h3')
    title.textContent = label
    const controls = document.createElement('div')
    controls.className = 'dock__cluster'
    wrapper.append(title, controls)
    menu.menu.append(wrapper)
    return controls
  }
  const left = section('Colony & controls')
  const equipment = section('Throwing')
  const right = section('Environment')
  const driving = section('Driving')
  driving.parentElement!.hidden = true
  const system = section('Display & sharing')
  root.append(status, primary, menu.chip)
  document.body.append(root)
  return {
    root, primary, status, left, right, equipment, driving, system,
    setVisible(visible) {
      if (root.hidden === !visible) return
      root.hidden = !visible
      if (!visible) closeEverything()
    },
    destroy() { menu.destroy(); root.remove() }
  }
}
