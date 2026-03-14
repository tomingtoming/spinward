import * as THREE from 'three'

import {
  isWatchActionDisabled,
  type WatchRenderSnapshot
} from './watchBindings'
import {
  WATCH_EXPANDED_SIZE,
  WATCH_STATUS_SIZE,
  createWatchExpandedLayout,
  getWatchButtonAtUv,
  type WatchActionId
} from './watchLayout'
import { renderWatchExpanded, renderWatchStatus } from './watchRenderer'

const STATUS_SCALE = new THREE.Vector3(0.14, 0.075, 1)
const EXPANDED_SCALE = new THREE.Vector3(0.25, 0.32, 1)
const WRIST_OFFSET = new THREE.Vector3(-0.016, -0.036, -0.014)
const BASE_PANEL_ROTATION = new THREE.Euler(-1.42, -0.12, -1.28)

const anchorPosition = new THREE.Vector3()
const anchorQuaternion = new THREE.Quaternion()
const wristOffset = new THREE.Vector3()
const basePanelQuaternion = new THREE.Quaternion().setFromEuler(BASE_PANEL_ROTATION)

const createCanvas = (width: number, height: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')

  if (context === null) {
    throw new Error('2D canvas context is required for the wrist UI')
  }

  return { canvas, context }
}

const createMaterial = (texture: THREE.CanvasTexture) =>
  new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    side: THREE.DoubleSide
  })

export class WatchPanel {
  readonly group = new THREE.Group()

  private readonly statusCanvas = createCanvas(
    WATCH_STATUS_SIZE.width,
    WATCH_STATUS_SIZE.height
  )
  private readonly statusTexture = new THREE.CanvasTexture(this.statusCanvas.canvas)
  private readonly statusMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    createMaterial(this.statusTexture)
  )
  private readonly expandedCanvas = createCanvas(
    WATCH_EXPANDED_SIZE.width,
    WATCH_EXPANDED_SIZE.height
  )
  private readonly expandedTexture = new THREE.CanvasTexture(this.expandedCanvas.canvas)
  private readonly expandedMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    createMaterial(this.expandedTexture)
  )
  private readonly layout = createWatchExpandedLayout()
  private hoveredAction: WatchActionId | null = null
  private snapshot: WatchRenderSnapshot | null = null
  private expanded = false

  constructor(private readonly onAction: (action: WatchActionId) => boolean | void) {
    this.statusTexture.colorSpace = THREE.SRGBColorSpace
    this.expandedTexture.colorSpace = THREE.SRGBColorSpace
    this.statusMesh.scale.copy(STATUS_SCALE)
    this.expandedMesh.scale.copy(EXPANDED_SCALE)
    this.expandedMesh.position.set(0, 0, 0)
    this.expandedMesh.visible = true
    this.statusMesh.visible = false
    this.group.renderOrder = 30
    this.group.add(this.statusMesh, this.expandedMesh)
    this.group.visible = false
    this.expanded = true
  }

  get isExpanded() {
    return this.expanded
  }

  get interactiveObject() {
    return this.expanded ? this.expandedMesh : null
  }

  get hasHover() {
    return this.hoveredAction !== null
  }

  setExpanded(expanded: boolean) {
    this.expanded = expanded
    this.expandedMesh.visible = expanded

    if (!expanded) {
      this.hoveredAction = null
    }
  }

  toggleExpanded() {
    this.setExpanded(!this.expanded)
  }

  update(
    snapshot: WatchRenderSnapshot,
    xrActive: boolean,
    leftGrip: THREE.Object3D | null
  ) {
    this.snapshot = snapshot

    if (!xrActive || leftGrip === null) {
      this.group.visible = false
      return
    }

    leftGrip.updateWorldMatrix(true, false)
    leftGrip.getWorldPosition(anchorPosition)
    leftGrip.getWorldQuaternion(anchorQuaternion)

    wristOffset.copy(WRIST_OFFSET).applyQuaternion(anchorQuaternion)
    this.group.position.copy(anchorPosition).add(wristOffset)
    this.group.quaternion.copy(anchorQuaternion).multiply(basePanelQuaternion)
    this.group.visible = true

    renderWatchStatus(this.statusCanvas.context, snapshot)
    this.statusTexture.needsUpdate = true

    if (this.expanded) {
      renderWatchExpanded(
        this.expandedCanvas.context,
        this.layout,
        snapshot,
        this.hoveredAction
      )
      this.expandedTexture.needsUpdate = true
    }
  }

  updateHover(uv: THREE.Vector2 | null) {
    if (!this.expanded || uv === null || this.snapshot === null) {
      this.hoveredAction = null
      return
    }

    const hoveredButton = getWatchButtonAtUv(this.layout, uv)
    this.hoveredAction =
      hoveredButton !== null && !isWatchActionDisabled(this.snapshot, hoveredButton.id)
        ? hoveredButton.id
        : null
  }

  clickHovered() {
    if (this.hoveredAction === null) {
      return false
    }

    return this.onAction(this.hoveredAction) ?? true
  }
}
