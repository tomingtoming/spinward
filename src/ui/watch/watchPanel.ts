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
const WRIST_BACK_MARGIN = 0.038
const WRIST_DORSAL_OFFSET = 0.008
const WRIST_LATERAL_OFFSET = -0.01
const WATCH_GAP = 0.028
const WATCH_FACE_CENTER = new THREE.Vector3(
  STATUS_SCALE.x * 0.5,
  STATUS_SCALE.y * 0.5,
  0
)
const EXPANDED_CENTER = new THREE.Vector3(
  STATUS_SCALE.x + WATCH_GAP + EXPANDED_SCALE.x * 0.5,
  EXPANDED_SCALE.y * 0.5,
  0
)

const anchorPosition = new THREE.Vector3()
const anchorQuaternion = new THREE.Quaternion()
const wristOrigin = new THREE.Vector3()
const controllerRight = new THREE.Vector3()
const controllerUp = new THREE.Vector3()
const controllerBack = new THREE.Vector3()
const panelNormal = new THREE.Vector3()
const panelBasis = new THREE.Matrix4()
const panelQuaternion = new THREE.Quaternion()
const panelFrameRotation = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(Math.PI, 0, Math.PI)
)

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
    this.statusMesh.position.copy(WATCH_FACE_CENTER)
    this.expandedMesh.position.copy(EXPANDED_CENTER)
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
    leftGrip: THREE.Object3D | null,
    leftController: THREE.Object3D | null
  ) {
    this.snapshot = snapshot

    if (!xrActive || leftGrip === null || leftController === null) {
      this.group.visible = false
      return
    }

    leftGrip.updateWorldMatrix(true, false)
    leftGrip.getWorldPosition(anchorPosition)
    leftController.updateWorldMatrix(true, false)
    leftController.getWorldQuaternion(anchorQuaternion)

    controllerRight.set(1, 0, 0).applyQuaternion(anchorQuaternion)
    controllerUp.set(0, 1, 0).applyQuaternion(anchorQuaternion)
    controllerBack.set(0, 0, 1).applyQuaternion(anchorQuaternion)
    panelNormal.crossVectors(controllerRight, controllerBack).normalize()

    wristOrigin
      .copy(anchorPosition)
      .addScaledVector(controllerBack, WRIST_BACK_MARGIN)
      .addScaledVector(controllerUp, WRIST_DORSAL_OFFSET)
      .addScaledVector(controllerRight, WRIST_LATERAL_OFFSET)

    panelBasis.makeBasis(controllerRight, controllerBack, panelNormal)
    this.group.position.copy(wristOrigin)
    panelQuaternion.setFromRotationMatrix(panelBasis).multiply(panelFrameRotation)
    this.group.quaternion.copy(panelQuaternion)
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
