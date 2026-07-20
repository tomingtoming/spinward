import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export type DetailedBuildingArchetype =
  | 'house'
  | 'residential'
  | 'setback'
  | 'slab'
  | 'lshape'
  | 'tower'
export type StreetDetailArchetype =
  | 'shopShutter'
  | 'shopGlass'
  | 'vendingPair'
  | 'serviceCluster'
  | 'bicycleRack'
  | 'planterAlley'
export type DetailedBuildingGeometryPack = Record<
  DetailedBuildingArchetype,
  [THREE.BufferGeometry, THREE.BufferGeometry]
> & {
  street: Record<StreetDetailArchetype, THREE.BufferGeometry>
}

const assetNames: Record<
  DetailedBuildingArchetype,
  readonly [string, string]
> = {
  house: ['house_a_lod0', 'house_a_lod1'],
  residential: ['residential_a_lod0', 'residential_a_lod1'],
  setback: ['setback_a_lod0', 'setback_a_lod1'],
  slab: ['slab_a_lod0', 'slab_a_lod1'],
  lshape: ['lshape_a_lod0', 'lshape_a_lod1'],
  tower: ['tower_a_lod0', 'tower_a_lod1']
}

const streetAssetNames: Record<StreetDetailArchetype, string> = {
  shopShutter: 'street_shop_shutter',
  shopGlass: 'street_shop_glass',
  vendingPair: 'street_vending_pair',
  serviceCluster: 'street_service_cluster',
  bicycleRack: 'street_bicycle_rack',
  planterAlley: 'street_planter_alley'
}

const buildingPackUrl = '/assets/buildings/spinward-buildings.glb'

const remapMaterialGroups = (source: THREE.Mesh, geometry: THREE.BufferGeometry) => {
  const materials = Array.isArray(source.material)
    ? source.material
    : [source.material]

  if (geometry.groups.length === 0) {
    const count =
      geometry.index?.count ?? geometry.getAttribute('position').count
    geometry.addGroup(0, count, 0)
    return
  }

  for (const group of geometry.groups) {
    const sourceMaterial = materials[group.materialIndex ?? 0]
    group.materialIndex = sourceMaterial?.name.includes('SIGN')
      ? 2
      : sourceMaterial?.name.includes('ROOF')
        ? 1
        : 0
  }
}

const collectGeometry = (source: THREE.Object3D) => {
  const meshes: THREE.Mesh[] = []
  source.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      meshes.push(object)
    }
  })

  if (meshes.length === 0) {
    throw new Error(`Detailed building ${source.name} contains no mesh`)
  }

  if (meshes.length === 1) {
    const mesh = meshes[0]
    mesh.updateWorldMatrix(true, false)
    const geometry = mesh.geometry.clone()
    geometry.applyMatrix4(mesh.matrixWorld)
    remapMaterialGroups(mesh, geometry)
    return geometry
  }

  // Blender's exporter emits one primitive per material. GLTFLoader represents
  // that as a named group containing facade and roof child meshes, so merge
  // them back into the grouped geometry expected by one InstancedMesh.
  const pieces: Array<{
    geometry: THREE.BufferGeometry
    count: number
    materialIndex: number
  }> = []

  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false)
    const geometry = mesh.geometry.clone()
    geometry.applyMatrix4(mesh.matrixWorld)
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]
    const materialIndex = materials.some((material) =>
      material.name.includes('SIGN')
    )
      ? 2
      : materials.some((material) => material.name.includes('ROOF'))
        ? 1
        : 0
    const count = geometry.index?.count ?? geometry.getAttribute('position').count
    geometry.clearGroups()
    pieces.push({ geometry, count, materialIndex })
  }

  const geometry = mergeGeometries(
    pieces.map((piece) => piece.geometry),
    false
  )
  for (const piece of pieces) {
    piece.geometry.dispose()
  }
  if (geometry === null) {
    throw new Error(`Detailed building ${source.name} primitives did not merge`)
  }

  geometry.clearGroups()
  let start = 0
  for (const piece of pieces) {
    geometry.addGroup(start, piece.count, piece.materialIndex)
    start += piece.count
  }
  return geometry
}

const normalizeGeometry = (source: THREE.Object3D) => {
  const geometry = collectGeometry(source)
  geometry.computeBoundingBox()

  const bounds = geometry.boundingBox
  if (bounds === null) {
    throw new Error(`Detailed building ${source.name} has no bounds`)
  }

  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  if (size.x <= 0 || size.y <= 0 || size.z <= 0) {
    geometry.dispose()
    throw new Error(`Detailed building ${source.name} has degenerate bounds`)
  }

  // Runtime archetypes occupy a unit box with local +Y up and a base at
  // y=-0.5, matching the procedural city geometry they replace.
  geometry.translate(-center.x, -bounds.min.y, -center.z)
  geometry.scale(1 / size.x, 1 / size.y, 1 / size.z)
  geometry.translate(0, -0.5, 0)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

// Uniform variant for models whose small-scale details (fences, doors,
// dormers) cannot survive anisotropic stretching: keep the native aspect,
// scale so the longest side is 1, and seat the base at y=0. The instancer
// then scales UNIFORMLY to fit the lot and the leftover lot becomes garden.
const normalizeGeometryUniform = (source: THREE.Object3D) => {
  const geometry = collectGeometry(source)
  geometry.computeBoundingBox()

  const bounds = geometry.boundingBox
  if (bounds === null) {
    throw new Error(`Detailed building ${source.name} has no bounds`)
  }

  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  const maxSide = Math.max(size.x, size.y, size.z)
  if (maxSide <= 0) {
    geometry.dispose()
    throw new Error(`Detailed building ${source.name} has degenerate bounds`)
  }

  geometry.translate(-center.x, -bounds.min.y, -center.z)
  geometry.scale(1 / maxSide, 1 / maxSide, 1 / maxSide)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

const prepareStreetGeometry = (source: THREE.Object3D) => {
  const geometry = collectGeometry(source)
  geometry.computeBoundingBox()

  const bounds = geometry.boundingBox
  if (bounds === null) {
    throw new Error(`Street detail ${source.name} has no bounds`)
  }

  const center = bounds.getCenter(new THREE.Vector3())
  geometry.translate(-center.x, -bounds.min.y, -center.z)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export const loadDetailedBuildingGeometryPack = async () => {
  const gltf = await new GLTFLoader().loadAsync(buildingPackUrl)

  const loadPair = (
    archetype: DetailedBuildingArchetype
  ): [THREE.BufferGeometry, THREE.BufferGeometry] => {
    const names = assetNames[archetype]
    return names.map((name) => {
      const source = gltf.scene.getObjectByName(name)
      if (source === undefined) {
        throw new Error(`Detailed building asset is missing ${name}`)
      }
      return normalizeGeometry(source)
    }) as [THREE.BufferGeometry, THREE.BufferGeometry]
  }

  const pack: DetailedBuildingGeometryPack = {
    house: loadPair('house'),
    residential: loadPair('residential'),
    setback: loadPair('setback'),
    slab: loadPair('slab'),
    lshape: loadPair('lshape'),
    tower: loadPair('tower'),
    street: Object.fromEntries(
      Object.entries(streetAssetNames).map(([archetype, name]) => {
        const source = gltf.scene.getObjectByName(name)
        if (source === undefined) {
          throw new Error(`Street detail asset is missing ${name}`)
        }
        return [archetype, prepareStreetGeometry(source)]
      })
    ) as Record<StreetDetailArchetype, THREE.BufferGeometry>
  }

  gltf.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return
    }
    object.geometry.dispose()
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material]
    for (const material of materials) {
      material.dispose()
    }
  })

  return pack
}

// ── Kenney kit buildings ────────────────────────────────────────────────
// District-specific architecture from the CC0 Kenney kits (kenney.nl): the
// port-end old town wears City Kit Commercial's brick-and-awning storefronts,
// the countryside's detached houses come from City Kit Suburban. The kits are
// flat-colour palette models, so the same normalize-to-unit-box + stretch-to-
// footprint instancing as the authored pack costs no texture distortion. The
// CBD keeps the authored Japanese kit — each district gets its own
// architectural language.

export type KenneyBuildingSet = 'commercial' | 'suburban'

export const KENNEY_COMMERCIAL_VARIANTS = [
  'a',
  'b',
  'c',
  'd',
  'e',
  'g',
  'i',
  'k'
] as const
export const KENNEY_SUBURBAN_VARIANTS = ['a', 'c', 'f', 'k', 'q', 'u'] as const

const KENNEY_BUILDING_BASE = '/assets/buildings/kenney'

export type KenneyBuildingGeometryPack = {
  // Per variant: [lod0, lod1] unit-box geometries.
  commercial: Array<[THREE.BufferGeometry, THREE.BufferGeometry]>
  suburban: Array<[THREE.BufferGeometry, THREE.BufferGeometry]>
  commercialMaterial: THREE.MeshStandardMaterial
  suburbanMaterial: THREE.MeshStandardMaterial
}

const captureKitMaterial = (scene: THREE.Object3D) => {
  let material: THREE.MeshStandardMaterial | null = null
  scene.traverse((object) => {
    if (material === null && object instanceof THREE.Mesh) {
      const first = Array.isArray(object.material)
        ? object.material[0]
        : object.material
      if (first instanceof THREE.MeshStandardMaterial) {
        material = first
      }
    }
  })
  return material as THREE.MeshStandardMaterial | null
}

export const loadKenneyBuildingGeometryPack =
  async (): Promise<KenneyBuildingGeometryPack> => {
    const loader = new GLTFLoader()
    let commercialMaterial: THREE.MeshStandardMaterial | null = null
    let suburbanMaterial: THREE.MeshStandardMaterial | null = null

    const loadOne = async (
      url: string,
      keepMaterial: 'commercial' | 'suburban' | null
    ) => {
      const gltf = await loader.loadAsync(url)
      const material = captureKitMaterial(gltf.scene)

      if (material !== null) {
        if (keepMaterial === 'commercial' && commercialMaterial === null) {
          commercialMaterial = material
        } else if (keepMaterial === 'suburban' && suburbanMaterial === null) {
          suburbanMaterial = material
        } else {
          material.map?.dispose()
          material.dispose()
        }
      }

      return normalizeGeometry(gltf.scene)
    }

    // All 22 files load CONCURRENTLY: awaited one by one on a live page the
    // fetch+parse+texture-decode of each round trip serializes against the
    // render loop and the pack takes minutes to arrive — the city would sit
    // on its fallbacks long after boot.
    const commercial = await Promise.all(
      KENNEY_COMMERCIAL_VARIANTS.map(
        async (variant): Promise<[THREE.BufferGeometry, THREE.BufferGeometry]> => [
          await loadOne(
            `${KENNEY_BUILDING_BASE}/commercial/building-${variant}.glb`,
            'commercial'
          ),
          await loadOne(
            `${KENNEY_BUILDING_BASE}/commercial/low-detail-building-${variant}.glb`,
            null
          )
        ]
      )
    )

    // Suburban ships no low-detail set; the houses are ~1.2k tris and only
    // dot the sparse countryside, so the detailed geometry serves both LODs.
    // They keep their native aspect (uniform normalize): a detached house
    // stretched to a 35 m farm lot turns its fences and door into abstract
    // slabs, so the instancer fits it uniformly and leaves the lot as garden.
    const suburban = await Promise.all(
      KENNEY_SUBURBAN_VARIANTS.map(
        async (variant): Promise<[THREE.BufferGeometry, THREE.BufferGeometry]> => {
          const gltf = await loader.loadAsync(
            `${KENNEY_BUILDING_BASE}/suburban/building-type-${variant}.glb`
          )
          const material = captureKitMaterial(gltf.scene)
          if (material !== null) {
            if (suburbanMaterial === null) {
              suburbanMaterial = material
            } else {
              material.map?.dispose()
              material.dispose()
            }
          }
          const geometry = normalizeGeometryUniform(gltf.scene)
          return [geometry, geometry]
        }
      )
    )

    if (commercialMaterial === null || suburbanMaterial === null) {
      throw new Error('Kenney building kits are missing their palette material')
    }

    return { commercial, suburban, commercialMaterial, suburbanMaterial }
  }

export const disposeKenneyBuildingGeometryPack = (
  pack: KenneyBuildingGeometryPack
) => {
  for (const pair of pack.commercial) {
    pair[0].dispose()
    pair[1].dispose()
  }
  for (const pair of pack.suburban) {
    // lod0 and lod1 share the geometry.
    pair[0].dispose()
  }
  pack.commercialMaterial.map?.dispose()
  pack.commercialMaterial.dispose()
  pack.suburbanMaterial.map?.dispose()
  pack.suburbanMaterial.dispose()
}

export const disposeDetailedBuildingGeometryPack = (
  pack: DetailedBuildingGeometryPack
) => {
  for (const archetype of Object.keys(assetNames) as DetailedBuildingArchetype[]) {
    const pair = pack[archetype]
    pair[0].dispose()
    pair[1].dispose()
  }
  for (const geometry of Object.values(pack.street)) {
    geometry.dispose()
  }
}
