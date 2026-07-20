import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

import type { CityRoad } from './cityLayout'

// ── Kenney City Kit (Roads) as the near-player road surface ─────────────
// The painted arc-band roads read as flat ribbons at street level. This layer
// lays real curb-and-sidewalk tiles (CC0, kenney.nl) over the roads around
// the player: straight segments, zebra approaches, and socket-matched
// crossroad / T / corner pieces at junctions — the tile-manifest generator
// from the 2026-07-20 sandbox, ported to the cylinder (θ,z) domain. The
// painted roads stay underneath as the complete far LOD and fallback.
//
// Tile mesh contract (measured from the kit): 1x1 footprint centred on the
// origin, base at y=0, road deck at y=0.01 spanning 0.8 of the tile across,
// sidewalks at y=0.02. Straight tiles run along mesh +X; the T stem exits
// +Z; the bend connects -X and +Z.

export type RoadTileKind = 'straight' | 'crossing' | 'crossroad' | 'tee' | 'bend'

export const ROAD_TILE_ASSET_URLS: Record<RoadTileKind, string> = {
  straight: '/assets/roads/road-straight.glb',
  crossing: '/assets/roads/road-crossing.glb',
  crossroad: '/assets/roads/road-crossroad-path.glb',
  tee: '/assets/roads/road-intersection-path.glb',
  bend: '/assets/roads/road-bend-sidewalk.glb'
}

// Road deck spans this fraction of the tile across; the rest is sidewalk.
// Tiles are scaled so the DECK matches the plan's road width, which puts a
// sidewalk band just outside the painted ribbon.
const ROAD_DECK_FRACTION = 0.8
// Mesh height is 0.02 at unit scale. Scaled uniformly with the footprint a
// 30 m arterial tile would grow 60 cm curbs, so height gets its own fixed
// scale: deck 5 cm, sidewalk top 10 cm. The deck stays purely visual (no
// collider, no ground-height contribution), so it is kept low enough that
// the car's tires reading ~5 cm into it passes as tarmac.
export const ROAD_TILE_HEIGHT_SCALE = 5
// Tiles must clear the painted roads they cover: streets ride at R-0.2 and
// avenues another junction-gap higher (see buildRoads — real radius replaces
// polygonOffset under the log depth buffer). Base the overlay just above the
// tallest painted layer so the deck never z-fights either road kind.
export const getRoadTileLiftMeters = (radius: number) =>
  0.2 + Math.max(0.03, radius * 1.5e-5) + 0.02
// Tiles are flat but the wall curves: a tangential run is split so each
// tile's chord sagitta (L²/8R) stays invisible — 20 m on r=3200 sags 1.6 cm,
// and small drums shrink the pitch further. Axial runs are straight and can
// stretch further.
const MAX_ALONG_AXIAL = 32
const maxAlongTangentFor = (radius: number) =>
  Math.min(20, Math.sqrt(0.4 * radius))
// Below this radius the curvature defeats flat tiles entirely: even a single
// road-width junction tile chords visibly through a playground-sized drum,
// so the overlay stays off and the painted roads carry the look alone.
const ROAD_TILE_MIN_RADIUS = 300
// Junction gaps thinner than this are left to the painted road.
const MIN_TILE_METERS = 2

export type RoadTilePlacement = {
  kind: RoadTileKind
  azimuth: number
  axial: number
  // Quarter turns about surface-up from the canonical pose (mesh +X along
  // +tangent, mesh +Z along -axial — the right-handed surface basis used by
  // the building instancing).
  quarterTurns: 0 | 1 | 2 | 3
  // Mesh-local scale in meters, applied before the quarter turns.
  alongMeters: number
  crossMeters: number
  distance: number
}

const TWO_PI = Math.PI * 2

const wrapToPi = (angle: number) => {
  const wrapped = ((angle % TWO_PI) + TWO_PI) % TWO_PI
  return wrapped > Math.PI ? wrapped - TWO_PI : wrapped
}

const surfaceDistance = (
  radius: number,
  azimuthA: number,
  axialA: number,
  azimuthB: number,
  axialB: number
) => Math.hypot(wrapToPi(azimuthA - azimuthB) * radius, axialA - axialB)

// Where mesh +X and +Z point on the surface after each quarter turn, in
// (tangent, axial) signs. Derived from R_y(q·π/2) inside the canonical basis
// (X=+tangent, Z=-axial).
//   q=0: +X→+t, +Z→-z    q=1: +X→+z, +Z→+t
//   q=2: +X→-t, +Z→+z    q=3: +X→-z, +Z→-t
type Junction = {
  azimuth: number
  axial: number
  // Tile envelope: tangential span (the avenue's tile width) and axial span
  // (the street's tile width).
  tangentMeters: number
  axialMeters: number
  // Whether each road continues past the junction.
  streetContinues: boolean
  avenueContinues: boolean
  // Interior directions (sign of tangent / axial) the ending road arrives from.
  streetInteriorSign: 1 | -1
  avenueInteriorSign: 1 | -1
  arterial: boolean
}

const junctionKind = (junction: Junction): RoadTileKind => {
  if (junction.streetContinues && junction.avenueContinues) {
    return 'crossroad'
  }
  if (!junction.streetContinues && !junction.avenueContinues) {
    return 'bend'
  }
  return 'tee'
}

const junctionQuarterTurns = (junction: Junction): 0 | 1 | 2 | 3 => {
  const kind = junctionKind(junction)

  if (kind === 'crossroad') {
    return 0
  }

  if (kind === 'tee') {
    if (!junction.streetContinues) {
      // Through-road is the avenue (mesh ±X must map to ±axial); the stem
      // (+Z) points back into the street.
      return junction.streetInteriorSign > 0 ? 1 : 3
    }
    // Through-road is the street; the stem points back into the avenue.
    return junction.avenueInteriorSign > 0 ? 2 : 0
  }

  // Bend: -X and +Z carry the two continuing roads.
  if (junction.streetInteriorSign < 0) {
    return junction.avenueInteriorSign < 0 ? 0 : 3
  }
  return junction.avenueInteriorSign < 0 ? 1 : 2
}

type FillInterval = {
  start: number
  end: number
  startAbutsJunction: boolean
  endAbutsJunction: boolean
}

// Subtract sorted obstacle intervals from [runStart, runEnd].
const subtractObstacles = (
  runStart: number,
  runEnd: number,
  obstacles: Array<{ start: number; end: number }>,
  runEndsAreOpen: boolean
): FillInterval[] => {
  const sorted = [...obstacles].sort((a, b) => a.start - b.start)
  const intervals: FillInterval[] = []
  let cursor = runStart
  let cursorAbuts = runEndsAreOpen

  for (const obstacle of sorted) {
    if (obstacle.end <= cursor) {
      continue
    }
    if (obstacle.start > cursor) {
      intervals.push({
        start: cursor,
        end: Math.min(obstacle.start, runEnd),
        startAbutsJunction: cursorAbuts,
        endAbutsJunction: obstacle.start <= runEnd
      })
    }
    cursor = Math.max(cursor, obstacle.end)
    cursorAbuts = true
    if (cursor >= runEnd) {
      break
    }
  }

  if (cursor < runEnd) {
    intervals.push({
      start: cursor,
      end: runEnd,
      startAbutsJunction: cursorAbuts,
      endAbutsJunction: runEndsAreOpen
    })
  }

  return intervals.filter((interval) => interval.end - interval.start >= MIN_TILE_METERS)
}

export type RoadTilePlanConfig = {
  roads: CityRoad[]
  radius: number
  focusAzimuth: number
  focusAxial: number
  rangeMeters: number
  maxTiles?: number
}

export const planRoadTilePlacements = (
  config: RoadTilePlanConfig
): RoadTilePlacement[] => {
  const { roads, radius, focusAzimuth, focusAxial, rangeMeters } = config
  const maxTiles = config.maxTiles ?? 512

  if (radius < ROAD_TILE_MIN_RADIUS || rangeMeters <= 0 || roads.length === 0) {
    return []
  }

  const avenues = roads.filter((road) => road.axialLength > road.tangentWidth)
  const streets = roads.filter((road) => road.axialLength <= road.tangentWidth)
  const placements: RoadTilePlacement[] = []

  const tileCross = (width: number) => width / ROAD_DECK_FRACTION

  // ── Junctions ───────────────────────────────────────────────────────
  type RoadObstacles = Map<CityRoad, Array<{ start: number; end: number }>>
  const avenueObstacles: RoadObstacles = new Map()
  const streetObstacles: RoadObstacles = new Map()

  for (const avenue of avenues) {
    const avenueTile = tileCross(avenue.tangentWidth)

    for (const street of streets) {
      const streetTile = tileCross(street.axialLength)
      const streetHalfSpan = street.tangentWidth * 0.5
      const avenueHalfSpan = avenue.axialLength * 0.5
      const tangentOffset = wrapToPi(avenue.azimuth - street.azimuth) * radius
      const axialOffset = street.axial - avenue.axial
      const fullRing = street.tangentWidth >= TWO_PI * radius - 1e-3

      if (!fullRing && Math.abs(tangentOffset) > streetHalfSpan + 1e-6) {
        continue
      }
      if (Math.abs(axialOffset) > avenueHalfSpan + 1e-6) {
        continue
      }

      const streetContinues =
        fullRing || Math.abs(tangentOffset) < streetHalfSpan - avenueTile * 0.75
      const avenueContinues =
        Math.abs(axialOffset) < avenueHalfSpan - streetTile * 0.75
      const junction: Junction = {
        azimuth: avenue.azimuth,
        axial: street.axial,
        tangentMeters: avenueTile,
        axialMeters: streetTile,
        streetContinues,
        avenueContinues,
        streetInteriorSign: tangentOffset > 0 ? -1 : 1,
        avenueInteriorSign: axialOffset > 0 ? -1 : 1,
        arterial: avenue.kind === 'arterial' || street.kind === 'arterial'
      }

      const avenueList = avenueObstacles.get(avenue) ?? []
      avenueList.push({
        start: axialOffset - streetTile * 0.5,
        end: axialOffset + streetTile * 0.5
      })
      avenueObstacles.set(avenue, avenueList)

      const streetList = streetObstacles.get(street) ?? []
      streetList.push({
        start: tangentOffset - avenueTile * 0.5,
        end: tangentOffset + avenueTile * 0.5
      })
      streetObstacles.set(street, streetList)

      const distance = surfaceDistance(
        radius,
        junction.azimuth,
        junction.axial,
        focusAzimuth,
        focusAxial
      )

      if (distance > rangeMeters) {
        continue
      }

      const quarterTurns = junctionQuarterTurns(junction)
      placements.push({
        kind: junctionKind(junction),
        azimuth: junction.azimuth,
        axial: junction.axial,
        quarterTurns,
        alongMeters: quarterTurns % 2 === 0 ? junction.tangentMeters : junction.axialMeters,
        crossMeters: quarterTurns % 2 === 0 ? junction.axialMeters : junction.tangentMeters,
        distance
      })
    }
  }

  // ── Straight runs between junctions ─────────────────────────────────
  const fillRoad = (
    road: CityRoad,
    isAvenue: boolean,
    obstacles: Array<{ start: number; end: number }>
  ) => {
    const width = isAvenue ? road.tangentWidth : road.axialLength
    const cross = tileCross(width)
    const maxAlong = isAvenue ? MAX_ALONG_AXIAL : maxAlongTangentFor(radius)
    const fullRing = !isAvenue && road.tangentWidth >= TWO_PI * radius - 1e-3

    // The run coordinate u is meters along the road, measured from the road
    // centre — except a full-circle street, which is measured from the FOCUS
    // azimuth so the seam lands on the far side, outside any usable range.
    const referenceAzimuth = fullRing ? focusAzimuth : road.azimuth
    let runStart: number
    let runEnd: number

    if (isAvenue) {
      runStart = -road.axialLength * 0.5
      runEnd = road.axialLength * 0.5
    } else if (fullRing) {
      runStart = -Math.PI * radius + 1
      runEnd = Math.PI * radius - 1
    } else {
      runStart = -road.tangentWidth * 0.5
      runEnd = road.tangentWidth * 0.5
    }

    // Clip to the focus window before splitting into tiles: a 20 km avenue
    // must not allocate thousands of intervals per rebuild.
    const focusU = isAvenue
      ? focusAxial - road.axial
      : wrapToPi(focusAzimuth - referenceAzimuth) * radius
    const window = rangeMeters + maxAlong
    const shiftedObstacles = fullRing
      ? obstacles.map((obstacle) => {
          // Obstacles were recorded relative to the road azimuth; re-express
          // around the focus reference.
          const centerU =
            wrapToPi(
              (obstacle.start + obstacle.end) * 0.5 / radius +
                road.azimuth -
                referenceAzimuth
            ) * radius
          const half = (obstacle.end - obstacle.start) * 0.5
          return { start: centerU - half, end: centerU + half }
        })
      : obstacles

    const clippedStart = Math.max(runStart, focusU - window)
    const clippedEnd = Math.min(runEnd, focusU + window)

    if (clippedEnd <= clippedStart) {
      return
    }

    const intervals = subtractObstacles(
      clippedStart,
      clippedEnd,
      shiftedObstacles,
      // A window-clipped edge is not a road end; treating it as open keeps
      // the zebra marker off arbitrary mid-block cut points.
      false
    ).map((interval) => ({
      ...interval,
      startAbutsJunction:
        interval.startAbutsJunction && interval.start > clippedStart + 1e-6,
      endAbutsJunction:
        interval.endAbutsJunction && interval.end < clippedEnd - 1e-6
    }))

    for (const interval of intervals) {
      const span = interval.end - interval.start
      const count = Math.max(1, Math.ceil(span / maxAlong))
      const pitch = span / count

      for (let index = 0; index < count; index += 1) {
        const u = interval.start + (index + 0.5) * pitch
        const azimuth = isAvenue ? road.azimuth : referenceAzimuth + u / radius
        const axial = isAvenue ? road.axial + u : road.axial
        const distance = surfaceDistance(radius, azimuth, axial, focusAzimuth, focusAxial)

        if (distance > rangeMeters) {
          continue
        }

        const abutsJunction =
          (index === 0 && interval.startAbutsJunction) ||
          (index === count - 1 && interval.endAbutsJunction)
        placements.push({
          kind: abutsJunction && road.kind === 'arterial' ? 'crossing' : 'straight',
          azimuth,
          axial,
          quarterTurns: isAvenue ? 1 : 0,
          alongMeters: pitch,
          crossMeters: cross,
          distance
        })
      }
    }
  }

  for (const avenue of avenues) {
    fillRoad(avenue, true, avenueObstacles.get(avenue) ?? [])
  }
  for (const street of streets) {
    fillRoad(street, false, streetObstacles.get(street) ?? [])
  }

  placements.sort((a, b) => a.distance - b.distance)
  placements.length = Math.min(placements.length, maxTiles)
  return placements
}

// ── Asset loading ───────────────────────────────────────────────────────

export type RoadTileGeometryPack = {
  geometries: Record<RoadTileKind, THREE.BufferGeometry>
  material: THREE.MeshStandardMaterial
}

const collectTileGeometry = (
  scene: THREE.Object3D
): { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial | null } => {
  let found: THREE.BufferGeometry | null = null
  let material: THREE.MeshStandardMaterial | null = null
  scene.traverse((object) => {
    if (found === null && object instanceof THREE.Mesh) {
      object.updateWorldMatrix(true, false)
      const geometry = object.geometry.clone() as THREE.BufferGeometry
      geometry.applyMatrix4(object.matrixWorld)
      found = geometry
      const first = Array.isArray(object.material) ? object.material[0] : object.material
      if (first instanceof THREE.MeshStandardMaterial) {
        material = first
      }
    }
  })
  if (found === null) {
    throw new Error('Road tile GLB contains no mesh')
  }
  return { geometry: found, material }
}

export const loadRoadTileGeometryPack = async (): Promise<RoadTileGeometryPack> => {
  const loader = new GLTFLoader()
  const entries = Object.entries(ROAD_TILE_ASSET_URLS) as Array<[RoadTileKind, string]>
  const geometries = {} as Record<RoadTileKind, THREE.BufferGeometry>
  let material: THREE.MeshStandardMaterial | null = null

  for (const [kind, url] of entries) {
    const gltf = await loader.loadAsync(url)
    const collected = collectTileGeometry(gltf.scene)
    geometries[kind] = collected.geometry
    // All tiles share the kit's one palette material; keep the first and
    // dispose the duplicates loaded with the other files.
    if (material === null && collected.material !== null) {
      material = collected.material
      const map = material.map
      if (map !== null) {
        // The palette texture is flat colour fields sampled at points; a bit
        // of anisotropy keeps the deck from shimmering at grazing angles.
        map.anisotropy = 8
      }
      // Never darker than the night city: a whisper of self-light so the
      // near-field streets don't read as a black hole between the glowing
      // painted roads and the lit facades.
      material.emissive = new THREE.Color(0x11181c)
      material.emissiveIntensity = 0.35
    } else if (collected.material !== null && collected.material !== material) {
      collected.material.map?.dispose()
      collected.material.dispose()
    }
  }

  if (material === null) {
    throw new Error('Road tile pack has no material')
  }

  return { geometries, material }
}

export const disposeRoadTileGeometryPack = (pack: RoadTileGeometryPack) => {
  for (const geometry of Object.values(pack.geometries)) {
    geometry.dispose()
  }
  pack.material.map?.dispose()
  pack.material.dispose()
}
