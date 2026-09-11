import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { CityBuilding } from './cityLayout';
import { cityBlockSpec, cityBlockDistance, selectCityBlockLod, type BlockSpec } from './authoredCityBlockPlan';
type Entry = {
    spec: BlockSpec;
    group: THREE.Group;
    levels: THREE.Group[];
    lod: number;
    fades: {
        value: number;
    }[];
    inverse: {
        value: number;
    }[];
    transition: {
        from: number;
        to: number;
        start: number;
    } | null;
    asset: boolean;
};
export class AuthoredCityBlock {
    readonly group = new THREE.Group();
    private entries: Entry[] = [];
    private assets = new Map<string, THREE.Group>();
    private requested = new Set<string>();
    private radius = 3200;
    private daylight = 1;
    private disposed = false;
    private projection = 935;
    constructor(parent: THREE.Group) { this.group.name = 'blender-city-block'; parent.add(this.group); }
    setProjection(pixelsPerRadian: number) { this.projection = Math.max(1, pixelsPerRadian); }
    rebuild(buildings: CityBuilding[], radius: number) {
        this.clear();
        this.radius = radius;
        for (const b of buildings) {
            const spec = cityBlockSpec(b, radius);
            if (!spec)
                continue;
            const group = new THREE.Group();
            group.name = 'block-' + spec.id;
            group.position.set(Math.cos(b.azimuth) * radius, b.axial, Math.sin(b.azimuth) * radius);
            this.group.add(group);
            const e: Entry = { spec, group, levels: Array.from({ length: 4 }, () => new THREE.Group()), lod: 3, fades: Array.from({ length: 4 }, () => ({ value: 1 })), inverse: Array.from({ length: 4 }, () => ({ value: 0 })), transition: null, asset: false };
            e.levels.forEach((g, i) => { g.name = spec.id + '-level-' + i; group.add(g); });
            this.entries.push(e);
            this.mount(e);
        }
    }
    private placeInTangentFrame(geometry: THREE.BufferGeometry, e: Entry) {
        const pos = geometry.getAttribute('position'), b = e.spec.building;
        for (let i = 0; i < pos.count; i++) {
            // A rigid tangent frame keeps large wall quads and their window relief
            // coplanar. Per-vertex bending produced different chords and depth fighting.
            // These <=24m lots bury the outer ground corners by at most 2.3cm.
            const a = b.azimuth, x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
            pos.setXYZ(i, -Math.cos(a) * y - Math.sin(a) * x, -z, -Math.sin(a) * y + Math.cos(a) * x);
        }
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
    }
    private mount(e: Entry) {
        this.clearEntry(e);
        const asset = this.assets.get(e.spec.id);
        e.asset = !!asset;
        if (!asset) {
            for (const v of e.spec.volumes) {
                const g = new THREE.BoxGeometry(v.w, v.h, v.d).translate(v.x, v.y, v.z);
                this.placeInTangentFrame(g, e);
                const m = new THREE.MeshStandardMaterial({ color: '#' + e.spec.wall, roughness: .8 });
                e.levels[3].add(new THREE.Mesh(g, m));
            }
        }
        else {
            for (let level = 0; level < 4; level++) {
                const source = asset.getObjectByName(e.spec.id + '_lod' + level);
                if (!source)
                    throw Error('Missing authored city LOD ' + level);
                source.updateWorldMatrix(true, true);
                source.traverse(o => {
                    if (!(o instanceof THREE.Mesh))
                        return;
                    const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
                    this.placeInTangentFrame(geometry, e);
                    const clone = (m: THREE.Material) => {
                        const material = m.clone();
                        material.onBeforeCompile = shader => {
                            shader.uniforms.blockFraction = e.fades[level];
                            shader.uniforms.blockInverse = e.inverse[level];
                            shader.fragmentShader = 'uniform float blockFraction; uniform float blockInverse;\n' + shader.fragmentShader;
                            shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float blockNoise=fract(sin(dot(floor(gl_FragCoord.xy),vec2(12.9898,78.233)))*43758.5453);
        if(blockInverse<.5?blockNoise>=blockFraction:blockNoise<blockFraction)discard;`);
                        };
                        material.customProgramCacheKey = () => 'city-block-dither-v1';
                        return material;
                    };
                    const mesh = new THREE.Mesh(geometry, Array.isArray(o.material) ? o.material.map(clone) : clone(o.material));
                    mesh.name = o.name;
                    mesh.castShadow = true;
                    mesh.receiveShadow = true;
                    e.levels[level].add(mesh);
                });
            }
        }
        e.transition = null;
        this.setDaylight(this.daylight);
    }
    update(azimuth: number, axial: number, altitude: number) {
        const params = new URLSearchParams(window.location.search), force = params.has('debug') && /^[0-4]$/.test(params.get('blockLod') ?? '') ? Number(params.get('blockLod')) : null;
        for (const e of this.entries) {
            const distance = cityBlockDistance(e.spec, this.radius, { azimuth, axial, altitude }), size = Math.max(e.spec.building.height, e.spec.building.width, e.spec.building.depth);
            const wanted = force ?? selectCityBlockLod(distance, size, e.lod, this.projection);
            if ((wanted < 4 || force !== null) && !this.requested.has(e.spec.id)) {
                this.requested.add(e.spec.id);
                new GLTFLoader().load('/assets/buildings/city-block-' + e.spec.id + '.glb', g => { if (this.disposed) {
                    this.releaseAsset(g.scene);
                    return;
                } if (![0, 1, 2, 3].every(level => g.scene.getObjectByName(e.spec.id + '_lod' + level))) {
                    this.releaseAsset(g.scene);
                    console.warn('Incomplete city building asset; keeping its architectural proxy.');
                    return;
                } this.assets.set(e.spec.id, g.scene); for (const item of this.entries)
                    if (item.spec.id === e.spec.id)
                        this.mount(item); }, undefined, () => console.warn('City building asset unavailable; keeping its architectural proxy.'));
            }
            const next = e.asset ? wanted : wanted === 4 ? 4 : 3;
            if (next !== e.lod) {
                e.transition = force === null && e.lod < 4 && next < 4 ? { from: e.lod, to: next, start: performance.now() } : null;
                e.lod = next;
            }
            e.levels.forEach((g, i) => { g.visible = i === e.lod; e.fades[i].value = 1; e.inverse[i].value = 0; });
            if (e.transition) {
                const t = Math.min(1, (performance.now() - e.transition.start) / 240), { from, to } = e.transition;
                if (t === 1)
                    e.transition = null;
                else {
                    e.levels[from].visible = e.levels[to].visible = true;
                    e.fades[from].value = e.fades[to].value = t;
                    e.inverse[from].value = 1;
                }
            }
            e.group.userData = { id: e.spec.id, lod: e.lod, distance, asset: e.asset, transitioning: !!e.transition };
        }
        this.group.userData = { buildings: this.entries.map(e => e.group.userData) };
    }
    setDaylight(daylight: number) {
        this.daylight = daylight;
        for (const e of this.entries)
            e.group.traverse(o => {
                if (!(o instanceof THREE.Mesh))
                    return;
                for (const m of Array.isArray(o.material) ? o.material : [o.material])
                    if (m instanceof THREE.MeshStandardMaterial)
                        m.emissiveIntensity = .03 + (1 - daylight) * .62;
            });
    }
    private clearEntry(e: Entry) { for (const g of e.levels) {
        g.traverse(o => { if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            for (const m of Array.isArray(o.material) ? o.material : [o.material])
                m.dispose();
        } });
        g.clear();
    } }
    private clear() { for (const e of this.entries) {
        this.clearEntry(e);
        e.group.removeFromParent();
    } this.entries = []; }
    private releaseAsset(asset: THREE.Object3D) { const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>(); asset.traverse(o => { if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
            materials.add(m);
    } }); for (const m of materials) {
        for (const v of Object.values(m))
            if (v instanceof THREE.Texture)
                textures.add(v);
        m.dispose();
    } for (const t of textures)
        t.dispose(); }
    dispose() { this.disposed = true; this.clear(); for (const a of this.assets.values())
        this.releaseAsset(a); this.assets.clear(); this.group.removeFromParent(); }
}
