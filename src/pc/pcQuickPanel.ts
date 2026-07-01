import { Vector2 } from 'three'

import {
  isWatchActionDisabled,
  type WatchRenderSnapshot
} from '../ui/watch/watchBindings'
import {
  WATCH_CANVAS_SIZE,
  createAllWatchLayouts,
  getWatchButtonAtUv,
  navTargetForAction,
  type WatchActionId,
  type WatchScreen
} from '../ui/watch/watchLayout'
import { renderWatch } from '../ui/watch/watchRenderer'

// The flat-screen settings panel. It reuses the wrist-watch canvas renderer, but
// instead of a 3D plane in front of the camera it lives in a window-pinned DOM
// drawer that slides in from the left. Clicks map straight from canvas pixels to
// the layout's UV hit-boxes — no raycast, no camera.
export class PcQuickPanel {
  private readonly root: HTMLDivElement
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private readonly layouts = createAllWatchLayouts()
  private readonly uv = new Vector2()
  private screen: WatchScreen = 'home'
  private snapshot: WatchRenderSnapshot | null = null
  private visible = false
  private active = true
  private hoveredAction: WatchActionId | null = null

  private get layout() {
    return this.layouts[this.screen]
  }

  constructor(private readonly onAction: (action: WatchActionId) => boolean | void) {
    this.root = document.createElement('div')
    this.root.className = 'quick-drawer'

    this.canvas = document.createElement('canvas')
    this.canvas.className = 'quick-drawer__canvas'
    this.canvas.width = WATCH_CANVAS_SIZE.width
    this.canvas.height = WATCH_CANVAS_SIZE.height
    const context = this.canvas.getContext('2d')

    if (context === null) {
      throw new Error('2D canvas context is required for the quick drawer')
    }

    this.context = context
    this.root.append(this.canvas)
    document.body.append(this.root)

    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    // Keep clicks inside the drawer from falling through to the canvas (throw).
    this.root.addEventListener('pointerdown', (event) => event.stopPropagation())
  }

  get isVisible() {
    return this.visible
  }

  toggle() {
    this.setVisible(!this.visible)
  }

  // Jumps straight to a screen (e.g. the dock's CONTROL button opens 'legend'
  // directly) instead of always reopening at 'home'.
  openScreen(screen: WatchScreen) {
    this.screen = screen
    this.hoveredAction = null
    this.setVisible(true)
  }

  setVisible(visible: boolean) {
    this.visible = visible

    if (!visible) {
      this.hoveredAction = null
      // Reopen at the top level rather than wherever it was last left.
      this.screen = 'home'
    }

    this.syncOpen()
  }

  // Called every frame. `active` is false in VR (or whenever the flat-screen UI
  // should stand down), where the DOM drawer must not show.
  update(snapshot: WatchRenderSnapshot, active: boolean) {
    this.snapshot = snapshot

    if (active !== this.active) {
      this.active = active

      if (!active) {
        this.setVisible(false)
        return
      }
    }

    if (this.visible && this.active) {
      this.render()
    }
  }

  destroy() {
    this.root.remove()
  }

  private syncOpen() {
    const open = this.visible && this.active
    this.root.classList.toggle('is-open', open)

    if (open) {
      this.render()
    }
  }

  private render() {
    if (this.snapshot === null) {
      return
    }

    renderWatch(this.context, this.layout, this.snapshot, this.hoveredAction)
  }

  private toUv(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect()
    this.uv.set(
      (event.clientX - rect.left) / rect.width,
      1 - (event.clientY - rect.top) / rect.height
    )
    return this.uv
  }

  private buttonAt(event: PointerEvent) {
    const button = getWatchButtonAtUv(this.layout, this.toUv(event))

    if (button === null || this.snapshot === null) {
      return null
    }

    return isWatchActionDisabled(this.snapshot, button.id) ? null : button
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    if (!this.visible) {
      return
    }

    const next = this.buttonAt(event)?.id ?? null

    if (next !== this.hoveredAction) {
      this.hoveredAction = next
      this.render()
    }
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    if (!this.visible || event.button !== 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const button = this.buttonAt(event)

    if (button === null) {
      return
    }

    // nav-* buttons drill between screens inside the panel; everything else is a
    // runtime action.
    const target = navTargetForAction(button.id)

    if (target !== null) {
      this.screen = target
      this.hoveredAction = null
      this.render()
      return
    }

    this.onAction(button.id)
    this.render()
  }
}
