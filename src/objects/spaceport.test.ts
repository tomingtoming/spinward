import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'

import { getSpaceportDimensions, getSpaceportEnvelopeRadius, Spaceport } from './spaceport'

describe('getSpaceportDimensions', () => {
  test('rebuilding the port releases per-instance resources as well as geometry', () => {
    const port = new Spaceport({ radius: 3200, length: 40000 })
    let instances = 0, geometries = 0, materialDisposals = 0
    port.group.traverse(object => {
      if (!(object instanceof THREE.InstancedMesh)) return
      object.addEventListener('dispose', () => instances++)
      object.geometry.addEventListener('dispose', () => geometries++)
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) material.addEventListener('dispose', () => materialDisposals++)
    })
    port.setDimensions({ radius: 18, length: 120 })
    expect(instances).toBe(1)
    expect(geometries).toBe(1)
    expect(materialDisposals).toBe(0)
    port.dispose()
    expect(materialDisposals).toBe(1)
  })

  test('the exterior envelope contains authored port meshes and the moving shuttle', () => {
    for (const [radius, length] of [[18, 120], [3200, 40000], [30000, 2000]]) {
      const port = new Spaceport({ radius, length })
      const envelope = getSpaceportEnvelopeRadius(radius, length)
      try {
        for (const dt of [0, 20, 30, 24, 2]) {
          port.update(dt); port.group.updateMatrixWorld(true)
          port.group.traverse(object => {
            if (!(object instanceof THREE.Mesh)) return
            object.geometry.computeBoundingBox()
            const bounds = object.geometry.boundingBox!
            for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
              expect(object.localToWorld(new THREE.Vector3(x, y, z)).length()).toBeLessThan(envelope)
            }
          })
        }
      } finally { port.dispose() }
    }
  })

  test('small habitats get a compact hub at the mirror-hinge (-Y) end', () => {
    const dims = getSpaceportDimensions(18, 120)
    expect(dims.hubCenterY).toBeCloseTo(-60, 6)
    expect(dims.hubRadius).toBeCloseTo(2.5, 6)
    expect(dims.hubLength).toBeCloseTo(20, 6)
    expect(dims.armLength).toBeCloseTo(8, 6)
  })

  test('giant habitats clamp the structure to sane absolute sizes', () => {
    const izma = getSpaceportDimensions(3200, 40000)
    expect(izma.hubRadius).toBeCloseTo(96, 6)
    expect(izma.hubLength).toBeCloseTo(600, 6)
    expect(izma.armLength).toBeCloseTo(360, 6)
    expect(izma.approachSpan).toBeCloseTo(3000, 6)

    const elysium = getSpaceportDimensions(30000, 2000)
    expect(elysium.hubRadius).toBeCloseTo(120, 6)
    expect(elysium.hubLength).toBeCloseTo(80, 6)
    expect(elysium.armLength).toBeCloseTo(360, 6)
  })

  test('hub structure stays clear of the habitat interior except the mouth', () => {
    // The hub straddles the -Y end plane: half inside (arrival bay), half out.
    const dims = getSpaceportDimensions(3200, 40000)
    expect(dims.hubCenterY + dims.hubLength * 0.5).toBeGreaterThan(-20000)
    expect(dims.hubCenterY - dims.hubLength * 0.5).toBeLessThan(-20000)
  })
})
