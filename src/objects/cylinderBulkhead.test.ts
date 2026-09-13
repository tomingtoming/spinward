import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { CylinderHabitat } from './cylinder'
import { FULL_360_TOPOLOGY, ISLAND_THREE_TOPOLOGY } from '../sim/habitatConfig'

test('wall material separation preserves opaque caps, daylight glazing and the open ring', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const gradient = () => ({ addColorStop() {} })
  const context = new Proxy({ createLinearGradient: gradient, createRadialGradient: gradient }, { get: (o, k) => k in o ? o[k as keyof typeof o] : () => {} })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } })
  try {
    for (const s of [
      { radius: 3200, length: 40000, topology: ISLAND_THREE_TOPOLOGY, type: 'cylinder' as const, disks: 128, total: 1520 },
      { radius: 18, length: 120, topology: FULL_360_TOPOLOGY, type: 'cylinder' as const, disks: 64, total: 1792 },
      { radius: 30000, length: 2000, topology: FULL_360_TOPOLOGY, type: 'ring' as const, disks: 0, total: 1152 }
    ]) {
      const habitat = new CylinderHabitat(s)
      const cap = habitat.group.getObjectByName('bulkhead-disks') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | undefined
      const frame = habitat.group.getObjectByName('end-cap-frames') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
      expect(cap ? cap.geometry.index!.count / 3 : 0).toBe(s.disks)
      expect((cap?.geometry.index?.count ?? 0) / 3 + frame.geometry.index!.count / 3).toBe(s.total)
      expect(frame.material.map).toBeNull(); expect(frame.material.emissiveIntensity).toBe(0)
      if (cap) {
        expect(cap.material.map!.image.width).toBe(512)
        expect(cap.material.emissiveMap!.image.width).toBe(1)
        expect(cap.material.emissiveIntensity).toBe(0)
        cap.updateMatrixWorld(true)
        for (const sign of [-1, 1]) {
          const ray = new THREE.Raycaster(new THREE.Vector3(s.radius * .5, 0, 0), new THREE.Vector3(0, sign, 0))
          const hits = ray.intersectObject(cap)
          expect(hits.length > 0).toBe(sign < 0 || s.topology === ISLAND_THREE_TOPOLOGY)
          if (hits.length) expect(hits[0].distance).toBeCloseTo(s.length / 2)
        }
      }
      let disposed = 0
      for (const mesh of [cap, frame]) mesh?.geometry.addEventListener('dispose', () => disposed++)
      habitat.setDimensions({ ...s, radius: s.radius * 1.1 })
      expect(disposed).toBe(cap ? 2 : 1)
      expect(habitat.group.getObjectByName('end-cap-frames')).not.toBe(frame)
      expect(habitat.group.children.filter(o => o.name === 'bulkhead-disks').length).toBe(s.disks ? 1 : 0)
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else delete (globalThis as { document?: Document }).document
  }
})
