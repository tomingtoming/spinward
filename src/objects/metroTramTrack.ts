import * as THREE from 'three'
import { railPoint } from '../gameplay/railService'
import type { ColonyRailData, RailLine } from '../worlds/colonyRailData'

const R = 3200 // railTrainMatrix places vehicles on this hull radius.
const point = (x: number, y: number, h: number) => [Math.cos(x / R) * (R - h), y, Math.sin(x / R) * (R - h)]

/** A ribbon offset from the centreline; profile corners are [lateral, lift]. */
function ribbon(line: RailLine, from: number, to: number, lateral: (s: number) => number,
  profile: [number, number][], positions: number[], indices: number[], height?: number) {
  const start = positions.length / 3, count = Math.max(2, Math.ceil((to - from) / 4) + 1)
  for (let i = 0; i < count; i++) {
    const s = from + (to - from) * i / (count - 1)
    for (const [side, lift] of profile) {
      const p = railPoint(line, s, lateral(s) + side)
      positions.push(...point(p[0], p[1], (height ?? p[2]) + lift))
    }
  }
  const n = profile.length
  for (let i = 1; i < count; i++) for (let j = 0; j < n - 1; j++) {
    const a = start + (i - 1) * n + j, b = start + i * n + j
    indices.push(a, b, a + 1, a + 1, b, b + 1)
  }
}

function mesh(name: string, positions: number[], indices: number[], color: string) {
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)).setIndex(indices)
  geometry.computeVertexNormals()
  const result = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: .7, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }))
  result.name = name; result.receiveShadow = true
  return result
}

/** Street track, terminal crossovers, stop islands and signs for Tokyo trams.
 * Visual only: walking and collision keep the unchanged source road surface. */
export class MetroTramTrack {
  readonly group = new THREE.Group()
  constructor(parent: THREE.Object3D, readonly data: ColonyRailData) {
    this.group.name = 'metro-tram-track'; parent.add(this.group)
    const { trackCentres: centres, gauge } = data.configuration, rails: number[] = [], railIndex: number[] = []
    const islands: number[] = [], islandIndex: number[] = []
    // Rail heads sit 3 cm proud of the paved street, 7 cm wide.
    const head: [number, number][] = [[-.035, .03], [.035, .03]]
    for (const line of data.lines) {
      for (const lane of [-centres, centres]) for (const g of [-gauge / 2, gauge / 2])
        ribbon(line, 0, line.length, () => lane + g, head, rails, railIndex)
      // RailService reverses cars across both tracks over 150 m from each terminal.
      const stops = line.stations.map(id => data.stations.find(s => s.id === id)!)
      for (const [terminal, direction] of [[stops[0].s, 1], [stops.at(-1)!.s, -1]] as const) {
        const end = terminal + direction * 150
        for (const g of [-gauge / 2, gauge / 2]) ribbon(line, Math.min(terminal, end), Math.max(terminal, end), s => {
          const u = Math.min(1, Math.abs(s - terminal) / 150)
          return direction * centres * (1 - 2 * u * u * (3 - 2 * u)) + g
        }, head, rails, railIndex)
      }
      for (const stop of stops) {
        const half = stop.platformLength / 2, edge = stop.platformWidth / 2
        ribbon(line, stop.s - half, stop.s + half, () => 0, [[-edge, .02], [edge, .02]], islands, islandIndex, stop.platform[2])
        this.group.add(this.sign(line, stop.s + half - 1, stop.name, line.color))
      }
    }
    this.group.add(mesh('metro-tram-rails', rails, railIndex, '#4f5657'), mesh('metro-tram-islands', islands, islandIndex, '#b9b6a8'))
  }
  private sign(line: RailLine, s: number, name: string, color: string) {
    const [x, y, h] = railPoint(line, s), a = x / R
    const up = new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a)), before = railPoint(line, s - 1), after = railPoint(line, s + 1)
    const along = new THREE.Vector3(...point(...after)).sub(new THREE.Vector3(...point(...before))).normalize()
    const facing = new THREE.Vector3().crossVectors(up, along).normalize()
    const sign = new THREE.Group(); sign.name = 'metro-tram-sign'
    sign.matrixAutoUpdate = false
    sign.matrix.makeBasis(new THREE.Vector3().crossVectors(up, facing), up, facing).setPosition(...point(x, y, h) as [number, number, number])
    const post = new THREE.Mesh(new THREE.BoxGeometry(.08, 2.4, .08), new THREE.MeshStandardMaterial({ color: '#4e5a57' }))
    post.position.y = 1.2
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 192
    const c = canvas.getContext('2d')!
    c.fillStyle = color; c.fillRect(0, 0, 512, 192); c.fillStyle = '#fafaf5'; c.textAlign = 'center'
    c.font = '64px system-ui, sans-serif'; c.fillText(name, 256, 110)
    c.font = '28px system-ui, sans-serif'; c.fillText(line.name, 256, 164)
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.4, .525), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }))
    panel.position.y = 2.2
    sign.add(post, panel)
    return sign
  }
  dispose() {
    this.group.removeFromParent()
    this.group.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      o.geometry.dispose()
      for (const m of [o.material].flat()) { (m as THREE.MeshBasicMaterial).map?.dispose(); m.dispose() }
    })
  }
}
