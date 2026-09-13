import * as THREE from 'three'
import { WetPavement } from '../../src/objects/wetPavement'
import { getCityExpressway } from '../../src/objects/cityLayout'
import { planExpresswayRainRoofs, type RainRoof, type RainArcRoof } from '../../src/objects/rainShelter'

// Isolated GPU fixture using the production material hook. Dry images are
// positive controls; cover must match the dry material, not a black frame.
async function runWetPavingProbe() {
  const R = 3200, road = getCityExpressway(R, 40000)!, arcs = planExpresswayRainRoofs(road, R)
  const point = (a: number, y: number, h: number) => new THREE.Vector3(Math.cos(a) * (R - h), y, Math.sin(a) * (R - h))
  const ramp = road.ramps[1], half = ramp.azimuthStart + ramp.azimuthSpan / 2
  const ax = road.axial + road.deckWidth / 2 + road.rampWidth / 2
  const bridge: RainRoof = { cos: 1, sin: 0, axial: 500, radial: R - 5.12, halfWidth: 25, halfDepth: 5.8, yaw: Math.atan(.25) }
  const corner = (x: number, z: number) => point((x * Math.cos(bridge.yaw!) - z * Math.sin(bridge.yaw!)) / R, 500 + x * Math.sin(bridge.yaw!) + z * Math.cos(bridge.yaw!), 1.2)
  const cases: { name: string; p: THREE.Vector3; wet: boolean; roofs?: RainRoof[]; arcs?: RainArcRoof[]; vertical?: boolean; distant?: boolean; reversed?: boolean; underside?: boolean; backSide?: boolean }[] = [
    { name: 'ring-under', p: point(-.02, road.axial, .34), wet: false },
    { name: 'ring-outside', p: point(-.02, road.axial - road.deckWidth / 2 - 2, .34), wet: true },
    { name: 'ring-top', p: point(-.02, road.axial, road.deckHeight), wet: true },
    { name: 'seam-left', p: point(-Math.PI + .001, road.axial, .34), wet: false },
    { name: 'seam-right', p: point(Math.PI - .001, road.axial, .34), wet: false },
    { name: 'other-land-strip', p: point(2 * Math.PI / 3, road.axial, .34), wet: false },
    { name: 'ramp-under', p: point(half, ax, .34), wet: false },
    { name: 'ramp-top', p: point(half, ax, (.22 + road.deckHeight) / 2), wet: true },
    { name: 'bridge-under', p: point(0, 500, 1.2), wet: false, roofs: [bridge], arcs: [] },
    { name: 'bridge-top', p: point(0, 500, 5.2), wet: true, roofs: [bridge], arcs: [] },
    { name: 'oblique-inside', p: corner(20, 5.3), wet: false, roofs: [bridge], arcs: [] },
    { name: 'oblique-outside', p: corner(20, 6.3), wet: true, roofs: [bridge], arcs: [] },
    { name: 'vertical-wall', p: point(0, 700, 4), wet: false, arcs: [], vertical: true },
    { name: 'far-pavement', p: point(0, 700, .34), wet: false, arcs: [], distant: true },
    { name: 'bridge-ceiling-above-mask', p: point(0, 500, 5.18), wet: false, roofs: [bridge], arcs: [], underside: true },
    { name: 'reversed-winding-footway', p: point(0, 700, .34), wet: true, arcs: [], reversed: true },
    { name: 'backside-cylinder-road', p: point(0, 700, .2), wet: true, arcs: [], reversed: true, backSide: true }
  ]
  const renderer = new THREE.WebGLRenderer({ antialias: false }); renderer.setSize(32, 32)
  const scene = new THREE.Scene(); scene.add(new THREE.AmbientLight(0xffffff, 2))
  const material = new THREE.MeshStandardMaterial({ color: '#909090', roughness: .95, side: THREE.DoubleSide })
  const baseline = material.clone(), wet = new WetPavement([material], true)
  const camera = new THREE.OrthographicCamera(-.25, .25, .25, -.25, .1, 20)
  const target = new THREE.WebGLRenderTarget(32, 32), pixels = new Uint8Array(32 * 32 * 4), results = []
  let mesh: THREE.Mesh | undefined
  try {
    for (const c of cases) {
      mesh?.geometry.dispose(); mesh?.removeFromParent()
      const a = Math.atan2(c.p.z, c.p.x), inward = new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a))
      const normal = c.vertical ? new THREE.Vector3(0, 1, 0) : inward
      const g = new THREE.PlaneGeometry(1, 1).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().multiplyScalar(c.reversed ? -1 : 1))).translate(c.p.x, c.p.y, c.p.z)
      for (const m of [material, baseline]) { m.side = c.backSide ? THREE.BackSide : THREE.DoubleSide; m.needsUpdate = true }
      mesh = new THREE.Mesh(g, material); scene.add(mesh)
      camera.position.copy(c.p).addScaledVector(normal, c.underside ? -5 : 5); camera.up.set(-Math.sin(a), 0, Math.cos(a)); camera.lookAt(c.p); camera.updateMatrixWorld(true)
      const focus = c.p.clone(); if (c.distant) focus.y += 500
      wet.update(1, 0, focus, c.roofs ?? [], c.arcs ?? arcs)
      const draw = (m: THREE.MeshStandardMaterial, amount: number) => {
        mesh!.material = m; wet.uniforms.pavingWetness.value = amount
        renderer.setRenderTarget(target); renderer.render(scene, camera); renderer.readRenderTargetPixels(target, 0, 0, 32, 32, pixels)
        return [...pixels.slice((16 * 32 + 16) * 4, (16 * 32 + 16) * 4 + 3)]
      }
      const original = draw(baseline, 0), dry = draw(material, 0), rain = draw(material, 1)
      if (original[0] < 40 || dry.some((v, i) => v !== original[i])) throw Error('Dry material changed ' + c.name)
      if (c.wet ? rain[0] >= dry[0] - 4 : rain.some((v, i) => v !== dry[i])) throw Error(JSON.stringify({ name: c.name, dry, rain }))
      results.push({ name: c.name, expectedWet: c.wet, original, dry, rain })
    }
    return results
  } finally { mesh?.geometry.dispose(); material.dispose(); baseline.dispose(); target.dispose(); renderer.dispose(); renderer.forceContextLoss() }
}
Object.assign(window, { runWetPavingProbe })
