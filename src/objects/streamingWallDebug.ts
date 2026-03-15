import * as THREE from 'three'

export type StreamingWallDebugSnapshot = {
  activeSectorIds: number[]
  totalSectorCount: number
}

type StreamingWallDebugUpdate = {
  radius: number
  length: number
  snapshot: StreamingWallDebugSnapshot
  visible: boolean
}

type SectorSpan = {
  startIndex: number
  count: number
}

const debugColor = new THREE.Color(0x22d3ee)

export const mergeActiveSectorSpans = (
  activeSectorIds: readonly number[],
  totalSectorCount: number
) => {
  if (activeSectorIds.length === 0 || totalSectorCount <= 0) {
    return [] as SectorSpan[]
  }

  const spans: SectorSpan[] = []
  let spanStart = activeSectorIds[0] ?? 0
  let spanCount = 1

  for (let index = 1; index < activeSectorIds.length; index += 1) {
    const sectorId = activeSectorIds[index] ?? 0
    const previousSectorId = activeSectorIds[index - 1] ?? 0

    if (sectorId === previousSectorId + 1) {
      spanCount += 1
      continue
    }

    spans.push({
      startIndex: spanStart,
      count: spanCount
    })
    spanStart = sectorId
    spanCount = 1
  }

  spans.push({
    startIndex: spanStart,
    count: spanCount
  })

  return spans
}

const getSectorMeshThetaStart = (
  startIndex: number,
  count: number,
  totalSectorCount: number
) => {
  const startAngle = (startIndex / totalSectorCount) * Math.PI * 2
  const endAngle = startAngle + (count / totalSectorCount) * Math.PI * 2
  return THREE.MathUtils.euclideanModulo(Math.PI * 0.5 - endAngle, Math.PI * 2)
}

export class StreamingWallDebugView {
  readonly group = new THREE.Group()

  private readonly material = new THREE.MeshBasicMaterial({
    color: debugColor,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.18,
    depthWrite: false
  })

  private readonly meshes: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>[] = []
  private lastSignature: string | null = null

  update({ radius, length, snapshot, visible }: StreamingWallDebugUpdate) {
    this.group.visible = visible

    if (!visible) {
      return
    }

    const signature = JSON.stringify({
      radius,
      length,
      totalSectorCount: snapshot.totalSectorCount,
      activeSectorIds: snapshot.activeSectorIds
    })

    if (signature === this.lastSignature) {
      return
    }

    this.lastSignature = signature
    this.rebuild(radius, length, snapshot)
  }

  dispose() {
    this.clearMeshes()
    this.material.dispose()
    this.group.parent?.remove(this.group)
  }

  private rebuild(
    radius: number,
    length: number,
    snapshot: StreamingWallDebugSnapshot
  ) {
    this.clearMeshes()

    if (snapshot.totalSectorCount <= 0 || snapshot.activeSectorIds.length === 0) {
      return
    }

    const spans = mergeActiveSectorSpans(
      snapshot.activeSectorIds,
      snapshot.totalSectorCount
    )
    const debugRadius = Math.max(0.5, radius - 0.12)
    const debugHeight = Math.max(1, length - 0.2)

    for (const span of spans) {
      const thetaLength = (span.count / snapshot.totalSectorCount) * Math.PI * 2
      const geometry = new THREE.CylinderGeometry(
        debugRadius,
        debugRadius,
        debugHeight,
        Math.max(4, span.count + 1),
        1,
        true,
        getSectorMeshThetaStart(
          span.startIndex,
          span.count,
          snapshot.totalSectorCount
        ),
        thetaLength
      )
      const mesh = new THREE.Mesh(geometry, this.material)
      mesh.renderOrder = 2
      this.group.add(mesh)
      this.meshes.push(mesh)
    }
  }

  private clearMeshes() {
    this.lastSignature = null

    for (const mesh of this.meshes.splice(0)) {
      mesh.geometry.dispose()
      this.group.remove(mesh)
    }
  }
}
