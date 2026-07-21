import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { CityBuilding } from './cityLayout'

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

export type KenneyBuildingSet = 'commercial' | 'skyscraper' | 'suburban'

export const KENNEY_COMMERCIAL_VARIANTS = [
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n'
] as const
// The five tall office prisms from the same Commercial kit: the CBD's
// architectural language. Stretch-fit like the mid-rises; no low-detail
// set ships, so the detailed geometry serves both LODs.
export const KENNEY_SKYSCRAPER_VARIANTS = ['a', 'b', 'c', 'd', 'e'] as const
export const KENNEY_SUBURBAN_VARIANTS = [
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'k',
  'l',
  'o',
  'q',
  's',
  'u'
] as const

const KENNEY_BUILDING_BASE = '/assets/buildings/kenney'

export type KenneyBuildingGeometryPack = {
  // Per variant: [lod0, lod1] unit-box geometries.
  commercial: Array<[THREE.BufferGeometry, THREE.BufferGeometry]>
  skyscraper: Array<[THREE.BufferGeometry, THREE.BufferGeometry]>
  suburban: Array<[THREE.BufferGeometry, THREE.BufferGeometry]>
  commercialMaterial: THREE.MeshStandardMaterial
  suburbanMaterial: THREE.MeshStandardMaterial
}

// The Kenney kits ship no emissive of their own, but the night skyline of
// lit windows is a signature of the city. The colormap cannot tell glass
// from wall (blue variants paint both from one gradient band), so windows
// are found GEOMETRICALLY: vertical faces recessed behind their local wall
// plane are glass. The verdict is painted into an aWindowGlow vertex
// attribute; the shader multiplies the material's warm emissive by it, and
// the frame loop drives emissiveIntensity with the day cycle like every
// other facade.
export const paintWindowGlowAttribute = (geometry: THREE.BufferGeometry) => {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const triangleCount = (index !== null ? index.count : position.count) / 3
  const vertexAt = (tri: number, corner: number) => {
    const raw = tri * 3 + corner
    return index !== null ? index.getX(raw) : raw
  }

  type Face = { offset: number; area: number; tri: number }
  const buckets = new Map<string, Face[]>()
  const p0 = new THREE.Vector3()
  const p1 = new THREE.Vector3()
  const p2 = new THREE.Vector3()
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()
  const n = new THREE.Vector3()

  for (let tri = 0; tri < triangleCount; tri += 1) {
    p0.fromBufferAttribute(position, vertexAt(tri, 0))
    p1.fromBufferAttribute(position, vertexAt(tri, 1))
    p2.fromBufferAttribute(position, vertexAt(tri, 2))
    n.copy(e1.subVectors(p1, p0)).cross(e2.subVectors(p2, p0))
    const area = n.length() / 2
    if (area < 1e-12) {
      continue
    }
    n.divideScalar(area * 2)
    if (Math.abs(n.y) > 0.3) {
      continue
    }
    const axis = Math.abs(n.x) > Math.abs(n.z) ? 'x' : 'z'
    const along = axis === 'x' ? n.x : n.z
    if (Math.abs(along) < 0.9) {
      continue
    }
    const sign = along > 0 ? 1 : -1
    const centroidY = (p0.y + p1.y + p2.y) / 3
    const offset =
      sign * ((axis === 'x' ? p0.x + p1.x + p2.x : p0.z + p1.z + p2.z) / 3)
    // Stepped masses have walls at several depths: bucket per height band
    // so each floor step finds its own wall plane.
    const key = `${axis}${sign}:${Math.round(centroidY * 10)}`
    const faces = buckets.get(key) ?? []
    faces.push({ offset, area, tri })
    buckets.set(key, faces)
  }

  const glow = new Float32Array(position.count)
  for (const faces of buckets.values()) {
    // The wall plane is the area-weighted dominant offset bin, so trims that
    // PROTRUDE past the wall do not drag the reference outward.
    const bins = new Map<number, number>()
    for (const face of faces) {
      const bin = Math.round(face.offset / 0.004)
      bins.set(bin, (bins.get(bin) ?? 0) + face.area)
    }
    let wallBin = 0
    let wallArea = -1
    for (const [bin, area] of bins) {
      if (area > wallArea) {
        wallArea = area
        wallBin = bin
      }
    }
    const wallOffset = wallBin * 0.004
    for (const face of faces) {
      if (wallOffset - face.offset > 0.003) {
        glow[vertexAt(face.tri, 0)] = 1
        glow[vertexAt(face.tri, 1)] = 1
        glow[vertexAt(face.tri, 2)] = 1
      }
    }
  }
  geometry.setAttribute('aWindowGlow', new THREE.BufferAttribute(glow, 1))
}

// Shader hook for the kit materials: emissive (warm, day-cycle-driven)
// applies only where aWindowGlow says glass.
export const installKenneyWindowGlow = (material: THREE.MeshStandardMaterial) => {
  material.emissive = new THREE.Color(0xffe9c4)
  material.emissiveIntensity = 0
  const previousCompile = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer)
    shader.vertexShader =
      'attribute float aWindowGlow;\nvarying float vWindowGlow;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vWindowGlow = aWindowGlow;'
      )
    shader.fragmentShader =
      'varying float vWindowGlow;\n' +
      shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vWindowGlow;'
      )
  }
  material.needsUpdate = true
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

      const geometry = normalizeGeometry(gltf.scene)
      paintWindowGlowAttribute(geometry)
      return geometry
    }

    // All the kit files load CONCURRENTLY: awaited one by one on a live page the
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
          paintWindowGlowAttribute(geometry)
          return [geometry, geometry]
        }
      )
    )

    // The skyscrapers ship in the Commercial kit and share its colormap, so
    // their materials are dropped in favour of the captured commercial one.
    const skyscraper = await Promise.all(
      KENNEY_SKYSCRAPER_VARIANTS.map(
        async (variant): Promise<[THREE.BufferGeometry, THREE.BufferGeometry]> => {
          const geometry = await loadOne(
            `${KENNEY_BUILDING_BASE}/commercial/building-skyscraper-${variant}.glb`,
            null
          )
          return [geometry, geometry]
        }
      )
    )

    if (commercialMaterial === null || suburbanMaterial === null) {
      throw new Error('Kenney building kits are missing their palette material')
    }

    return { commercial, skyscraper, suburban, commercialMaterial, suburbanMaterial }
  }

export const disposeKenneyBuildingGeometryPack = (
  pack: KenneyBuildingGeometryPack
) => {
  for (const pair of pack.commercial) {
    pair[0].dispose()
    pair[1].dispose()
  }
  for (const pair of pack.skyscraper) {
    // lod0 and lod1 share the geometry.
    pair[0].dispose()
  }
  for (const pair of pack.suburban) {
    // lod0 and lod1 share the geometry.
    pair[0].dispose()
  }
  pack.commercialMaterial.map?.dispose()
  pack.commercialMaterial.emissiveMap?.dispose()
  pack.commercialMaterial.dispose()
  pack.suburbanMaterial.map?.dispose()
  pack.suburbanMaterial.emissiveMap?.dispose()
  pack.suburbanMaterial.dispose()
}

// ── Suburban house real-size fit ────────────────────────────────────────
// The suburban kit is placed at REAL size — a detached house is 6–8 m tall
// no matter how big its parcel is — instead of scaled to the procedural lot
// box. Lot-fitting made the miniature tail visible: the box heights the plan
// rolls (3–10 m) became the houses' scale, and unlike the facade-UV pipeline
// (whose windows stay metre-true under any stretch) a kit model shrinks its
// doors with it. The fit is pure math over baked model bounds so the plan
// consumers (collision, tests) agree with the render without loading GLBs.

// Native bounding sizes of the suburban GLBs, measured from the assets in
// KENNEY_SUBURBAN_VARIANTS order. normalizeGeometryUniform divides by the
// longest side, so runtime geometry reproduces these ratios exactly.
const KENNEY_SUBURBAN_RAW_SIZES: ReadonlyArray<readonly [number, number, number]> = [
  [1.3, 0.83, 1.03], // a — dormered single-storey
  [1.83, 1.14, 1.14], // b — wide two-storey
  [1.29, 1.03, 1.03], // c — two-storey, stepped wing
  [1.76, 1.24, 1.03], // d — long two-storey
  [1.3, 1.14, 1.03], // e — two-storey
  [1.43, 1.14, 1.41], // f — large two-storey
  [1.45, 0.77, 1.18], // g — single-storey ranch
  [1.3, 0.74, 0.92], // h — small single-storey
  [0.92, 1.15, 1.02], // k — narrow mono-pitch two-storey
  [1.03, 1.05, 1.02], // l — compact two-storey
  [1.27, 1.14, 1.03], // o — two-storey
  [1.24, 0.92, 0.89], // q — flat-roof two-storey with carport
  [1.41, 1.14, 1.09], // s — two-storey
  [1.43, 1.14, 1.09] // u — two-storey with garage
]

// Real-world stature each variant depicts (m). Storeys priced at ~3.2 m
// plus roof; the dormered bungalow sits under the full two-storey band.
export const KENNEY_SUBURBAN_HEIGHT_M: readonly number[] = [
  6.0, 7.5, 7.5, 7.8, 7.5, 8.0, 4.8, 4.6, 7.5, 7.2, 7.5, 6.5, 7.5, 7.5
]

// Houses sit at the BACK of their parcel — rear wall this far off the back
// boundary — leaving the garden as a front yard toward the street.
const SUBURBAN_REAR_SETBACK_M = 2

// The parcel a suburban pipeline stage works in: the plan-recorded slot
// rectangle when present, else the building box (synthetic footprints,
// pre-parcel plans). Offsets are from the building centre.
export const suburbanParcelRect = (
  building: CityBuilding
): NonNullable<CityBuilding['parcel']> =>
  building.parcel ?? {
    tangentOffset: 0,
    axialOffset: 0,
    tangentExtent: building.width,
    axialExtent: building.depth
  }

// Deterministic per-building hash reused by every facade choice: stable
// across focus rebuilds, no plan RNG consumed.
export const facadePaletteIndex = (building: CityBuilding, buckets: number) => {
  const hash = Math.abs(
    Math.sin(building.azimuth * 53.13 + building.axial * 0.271 + building.tone * 17.3)
  )
  return Math.floor(hash * buckets) % buckets
}

// District architecture: which Kenney kit dresses this building in the near
// disk. The whole skyline speaks Kenney now — the authored Japanese kit is
// retired for buildings: the old town wears Commercial storefronts, the
// countryside's detached houses come from Suburban, the CBD's tall
// furniture (tower/setback/slab) wears the Commercial kit's skyscraper
// prisms, and every remaining mass is a Commercial mid-rise. Deterministic
// from fields the building already carries — no plan RNG consumed.
export const kenneyPickForBuilding = (
  building: CityBuilding
): { set: KenneyBuildingSet; variant: number } => {
  if ((building.oldTown ?? 0) >= 0.5) {
    return {
      set: 'commercial',
      variant: facadePaletteIndex(building, KENNEY_COMMERCIAL_VARIANTS.length)
    }
  }
  if (building.kind === 'house' && (building.urban ?? 1) < 0.4) {
    return {
      set: 'suburban',
      variant: facadePaletteIndex(building, KENNEY_SUBURBAN_VARIANTS.length)
    }
  }
  if (
    building.kind === 'tower' ||
    building.kind === 'setback' ||
    building.kind === 'slab'
  ) {
    return {
      set: 'skyscraper',
      variant: facadePaletteIndex(building, KENNEY_SKYSCRAPER_VARIANTS.length)
    }
  }
  return {
    set: 'commercial',
    variant: facadePaletteIndex(building, KENNEY_COMMERCIAL_VARIANTS.length)
  }
}

export type SuburbanHouseFit = {
  variant: number
  // Uniform scale applied to the normalized (longest-side-1) geometry.
  scale: number
  // Fitted world extents (m) on the cylinder axes.
  tangentExtent: number
  axialExtent: number
  height: number
  // Centre shift from the lot centre (m) that seats the house at its
  // street-front setback; the rest of the lot is garden.
  tangentOffset: number
  axialOffset: number
  front: NonNullable<CityBuilding['front']>
}

// Real-size placement for a suburban house: aim the facade (+Z of the
// normalized model) at the fronting street, seat it a lawn's setback behind
// the lot's street edge, and hold its real stature (±8% deterministic
// jitter) unless the parcel is genuinely too small. Returns null for
// buildings the suburban kit does not dress.
export const fitSuburbanHouse = (
  building: CityBuilding
): SuburbanHouseFit | null => {
  const pick = kenneyPickForBuilding(building)
  if (pick === null || pick.set !== 'suburban') {
    return null
  }

  const raw = KENNEY_SUBURBAN_RAW_SIZES[pick.variant]
  const maxSide = Math.max(raw[0], raw[1], raw[2])
  const modelX = raw[0] / maxSide
  const modelY = raw[1] / maxSide
  const modelZ = raw[2] / maxSide

  // Pre-`front` plans (and any synthetic footprint) keep the legacy aim:
  // the door wall used to face −axial for every house.
  const front = building.front ?? ({ axis: 'axial', side: -1 } as const)
  // Work in parcel space: (f, c) with +f streetward along the front axis.
  const parcel = suburbanParcelRect(building)
  const parcelF = front.axis === 'tangent' ? parcel.tangentExtent : parcel.axialExtent
  const parcelC = front.axis === 'tangent' ? parcel.axialExtent : parcel.tangentExtent
  const parcelCentreF =
    (front.axis === 'tangent' ? parcel.tangentOffset : parcel.axialOffset) *
    front.side
  const parcelCentreC =
    front.axis === 'tangent' ? parcel.axialOffset : parcel.tangentOffset

  // A second hash with its own constants so stature does not correlate with
  // the palette pick.
  const jitter =
    0.92 +
    0.16 *
      Math.abs(
        Math.sin(
          building.azimuth * 97.7 + building.axial * 0.173 + building.tone * 29.1
        )
      )
  const scale = Math.min(
    (KENNEY_SUBURBAN_HEIGHT_M[pick.variant] * jitter) / modelY,
    // The facade spans the cross axis (model x), the door axis is model z.
    // The metre floors only engage on toy-scale habitats.
    Math.max(1, parcelC - 1) / modelX,
    Math.max(1, parcelF - SUBURBAN_REAR_SETBACK_M - 0.7) / modelZ
  )

  // Rear placement: back wall a fixed setback off the back boundary, the
  // garden opening toward the street as a front yard.
  const houseF =
    parcelCentreF - parcelF / 2 + SUBURBAN_REAR_SETBACK_M + (modelZ * scale) / 2
  // Keep the building box's cross jitter, clamped inside the parcel with
  // clearance for the on-lot-line side boundary.
  const crossRoom = Math.max(0, parcelC / 2 - (modelX * scale) / 2 - 0.6)
  const houseC = Math.min(
    parcelCentreC + crossRoom,
    Math.max(parcelCentreC - crossRoom, 0)
  )

  return {
    variant: pick.variant,
    scale,
    tangentExtent: (front.axis === 'tangent' ? modelZ : modelX) * scale,
    axialExtent: (front.axis === 'tangent' ? modelX : modelZ) * scale,
    height: modelY * scale,
    tangentOffset: front.axis === 'tangent' ? houseF * front.side : houseC,
    axialOffset: front.axis === 'axial' ? houseF * front.side : houseC,
    front
  }
}

// ── Suburban lot boundaries ─────────────────────────────────────────────
// A hedge or picket fence around each detached-house parcel, with a gate
// gap on the street side. The boundary is what turns "houses on a shared
// lawn" into readable parcels — the suburb's grain. Flat-colour boxes, so
// no new assets; segments are pure math shared by render and tests.

export type SuburbanLotBoundarySegment = {
  // Centre offset from the LOT centre and extents, in surface metres.
  tangentOffset: number
  axialOffset: number
  tangentExtent: number
  axialExtent: number
}

export type SuburbanLotBoundary = {
  style: 'hedge' | 'fence'
  height: number
  segments: SuburbanLotBoundarySegment[]
}

const BOUNDARY_INSET_M = 0.35
const GATE_WIDTH_M = 2.6
const HEDGE_THICKNESS_M = 0.5
const FENCE_THICKNESS_M = 0.15

export const suburbanLotBoundary = (
  building: CityBuilding,
  fit: SuburbanHouseFit
): SuburbanLotBoundary => {
  // A third hash constant set so the boundary style decorrelates from both
  // the palette and the stature picks.
  const hash = Math.abs(
    Math.sin(
      building.azimuth * 41.3 + building.axial * 0.311 + building.tone * 23.7
    )
  )
  // |sin| clusters toward 1 (arcsine density), so the even-split point is
  // ~0.71; 0.83 keeps hedges the suburb's default (~2 in 3) with picket
  // fences as the accent.
  const style: SuburbanLotBoundary['style'] = hash < 0.83 ? 'hedge' : 'fence'
  const thickness = style === 'hedge' ? HEDGE_THICKNESS_M : FENCE_THICKNESS_M
  const height = style === 'hedge' ? 0.95 + 0.4 * ((hash * 7.3) % 1) : 0.85

  // Work in (f, c) parcel space: +f points streetward along the front axis,
  // c spans the cross axis, origin at the PARCEL centre. Mapped back to
  // building-centre-relative (tangent, axial) at the end.
  const front = fit.front
  const parcel = suburbanParcelRect(building)
  const parcelF = front.axis === 'tangent' ? parcel.tangentExtent : parcel.axialExtent
  const parcelC = front.axis === 'tangent' ? parcel.axialExtent : parcel.tangentExtent
  const parcelCentreF =
    (front.axis === 'tangent' ? parcel.tangentOffset : parcel.axialOffset) *
    front.side
  const parcelCentreC =
    front.axis === 'tangent' ? parcel.axialOffset : parcel.tangentOffset
  const houseF = front.axis === 'tangent' ? fit.tangentExtent : fit.axialExtent
  const houseC = front.axis === 'tangent' ? fit.axialExtent : fit.tangentExtent
  const houseCentreF =
    (front.axis === 'tangent' ? fit.tangentOffset : fit.axialOffset) * front.side -
    parcelCentreF
  const houseCentreC =
    (front.axis === 'tangent' ? fit.axialOffset : fit.tangentOffset) -
    parcelCentreC

  // The street side keeps its sidewalk clearance; rear and side runs sit
  // half a thickness in, so their outer FACES land exactly on the lot lines
  // and neighbouring parcels' boundaries meet with no lawn strip between —
  // the American-suburb fence-against-fence look.
  const fEdge = parcelF / 2 - BOUNDARY_INSET_M
  const fEdgeBack = parcelF / 2 - thickness / 2
  const cEdge = parcelC / 2 - thickness / 2

  type FcSegment = { f: number; c: number; fExtent: number; cExtent: number }
  const segments: FcSegment[] = []

  // Street edge: two runs flanking the gate, which lines up with the house's
  // cross centre so gate, path and door share one axis. On parcels so
  // shallow that the house reaches the boundary line, the street runs are
  // dropped with it.
  if (houseCentreF + houseF / 2 <= fEdge - thickness / 2 - 0.2) {
    for (const [from, to] of [
      [-cEdge, houseCentreC - GATE_WIDTH_M / 2],
      [houseCentreC + GATE_WIDTH_M / 2, cEdge]
    ]) {
      if (to - from >= 1) {
        segments.push({
          f: fEdge,
          c: (from + to) / 2,
          fExtent: thickness,
          cExtent: to - from
        })
      }
    }
  }

  // Back edge, unless the house butts against it.
  if (houseCentreF - houseF / 2 > -fEdgeBack + thickness / 2 + 0.2) {
    segments.push({
      f: -fEdgeBack,
      c: 0,
      fExtent: thickness,
      cExtent: cEdge * 2 + thickness
    })
  }

  // Side edges, unless the house fills the parcel's cross extent. They run
  // from the street hedge line to the rear lot line.
  if (
    Math.max(houseCentreC + houseC / 2, -(houseCentreC - houseC / 2)) <=
    cEdge - thickness / 2 - 0.2
  ) {
    for (const side of [-1, 1]) {
      segments.push({
        f: (fEdge - fEdgeBack) / 2,
        c: side * cEdge,
        fExtent: fEdge + fEdgeBack,
        cExtent: thickness
      })
    }
  }

  return {
    style,
    height,
    segments: segments.map((segment) => {
      const fWorld = (parcelCentreF + segment.f) * front.side
      const cWorld = parcelCentreC + segment.c
      return front.axis === 'tangent'
        ? {
            tangentOffset: fWorld,
            axialOffset: cWorld,
            tangentExtent: segment.fExtent,
            axialExtent: segment.cExtent
          }
        : {
            tangentOffset: cWorld,
            axialOffset: fWorld,
            tangentExtent: segment.cExtent,
            axialExtent: segment.fExtent
          }
    })
  }
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
