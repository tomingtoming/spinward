import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export type DetailedBuildingArchetype =
  | 'house'
  | 'residential'
  | 'slab'
  | 'tower'
export type DetailedBuildingGeometryPack = Record<
  DetailedBuildingArchetype,
  [THREE.BufferGeometry, THREE.BufferGeometry]
>

const assetNames: Record<
  DetailedBuildingArchetype,
  readonly [string, string]
> = {
  house: ['house_a_lod0', 'house_a_lod1'],
  residential: ['residential_a_lod0', 'residential_a_lod1'],
  slab: ['slab_a_lod0', 'slab_a_lod1'],
  tower: ['tower_a_lod0', 'tower_a_lod1']
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
    slab: loadPair('slab'),
    tower: loadPair('tower')
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

export const disposeDetailedBuildingGeometryPack = (
  pack: DetailedBuildingGeometryPack
) => {
  for (const pair of Object.values(pack)) {
    pair[0].dispose()
    pair[1].dispose()
  }
}
