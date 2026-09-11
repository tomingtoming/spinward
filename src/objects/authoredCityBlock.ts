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
    private batches: THREE.InstancedMesh[] = [];
    private batchSignature = '';
    private loading = false;
    private nextLoadAt = 0;
    private focus={azimuth:0,axial:0,altitude:3200};
    constructor(parent: THREE.Group) { this.group.name = 'blender-city-block'; parent.add(this.group); }
    isBuildingVisible(b:CityBuilding){return this.entries.some(e=>e.spec.building.azimuth===b.azimuth&&e.spec.building.axial===b.axial&&e.lod<4)}
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
            const a=b.azimuth,side=b.front?.side??-1;
            const across=new THREE.Vector3(side*Math.sin(a),0,-side*Math.cos(a)),front=new THREE.Vector3(0,side,0);
            if(b.front?.axis==='tangent'){across.set(0,side,0);front.set(-side*Math.sin(a),0,side*Math.cos(a))}
            group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across,new THREE.Vector3(-Math.cos(a),0,-Math.sin(a)),front));
            this.group.add(group);
            const e: Entry = { spec, group, levels: Array.from({ length: 4 }, () => new THREE.Group()), lod: 3, fades: Array.from({ length: 4 }, () => ({ value: 1 })), inverse: Array.from({ length: 4 }, () => ({ value: 0 })), transition: null, asset: false };
            e.levels.forEach((g, i) => { g.name = spec.id + '-level-' + i; group.add(g); });
            this.entries.push(e);
            this.mount(e);
        }
    }
    private mount(e: Entry, includeNear=false) {
        this.clearEntry(e);
        const asset = this.assets.get(e.spec.id);
        e.asset = !!asset;
        if (!asset) {
            for (const v of e.spec.volumes) {
                const g = new THREE.BoxGeometry(v.w, v.h, v.d).translate(v.x, v.y, v.z);

                const m = new THREE.MeshStandardMaterial({ color: '#' + e.spec.wall, roughness: .8 });
                e.levels[3].add(new THREE.Mesh(g, m));
            }
        }
        else {
            const near=includeNear || cityBlockDistance(e.spec,this.radius,this.focus)<180;
            for (let level = 0; level < 4; level++) {
                if(level<2 && !near)continue;
                const source = asset.getObjectByName(e.spec.id + '_lod' + level);
                if (!source)
                    throw Error('Missing authored city LOD ' + level);
                source.updateWorldMatrix(true, true);
                source.traverse(o => {
                    if (!(o instanceof THREE.Mesh))
                        return;
                    const geometry = o.geometry;
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
                    mesh.applyMatrix4(o.matrixWorld);
                    mesh.position.z += e.spec.offsetZ ?? 0;
                    mesh.name = o.name;
                    mesh.castShadow = true;
                    mesh.receiveShadow = true;
                    e.levels[level].add(mesh);
                });
            }
        }
        e.transition = null;
        this.setDaylight(this.daylight, true);
    }
    update(azimuth: number, axial: number, altitude: number) {
        this.focus={azimuth,axial,altitude};
        const params = new URLSearchParams(window.location.search), force = params.has('debug') && /^[0-4]$/.test(params.get('blockLod') ?? '') ? Number(params.get('blockLod')) : null;
        const closest = this.entries.filter(e=>!this.requested.has(e.spec.id)).sort((a,b)=>cityBlockDistance(a.spec,this.radius,{azimuth,axial,altitude})-cityBlockDistance(b.spec,this.radius,{azimuth,axial,altitude}))[0];
        for (const e of this.entries) {
            const distance = cityBlockDistance(e.spec, this.radius, { azimuth, axial, altitude }), size = Math.max(e.spec.building.height, e.spec.building.width, e.spec.building.depth);
            const wanted = force ?? selectCityBlockLod(distance, size, e.lod, this.projection);
            if ((wanted < 4 || force !== null) && e===closest && !this.loading && performance.now()>=this.nextLoadAt && !this.requested.has(e.spec.id)) {
                this.loading=true;
                this.requested.add(e.spec.id);
                new GLTFLoader().load('/assets/buildings/city-block-' + e.spec.id + '.glb', g => { this.loading=false; this.nextLoadAt=performance.now()+180; if (this.disposed) {
                    this.releaseAsset(g.scene);
                    return;
                } if (![0, 1, 2, 3].every(level => g.scene.getObjectByName(e.spec.id + '_lod' + level))) {
                    this.releaseAsset(g.scene);
                    console.warn('Incomplete city building asset; keeping its architectural proxy.');
                    return;
                } this.assets.set(e.spec.id, g.scene); for (const item of this.entries)
                    if (item.spec.id === e.spec.id)
                        this.mount(item); }, undefined, () => {this.loading=false;this.nextLoadAt=performance.now()+180;console.warn('City building asset unavailable; keeping its architectural proxy.')});
            }
            if(e.asset && wanted<2 && e.levels[wanted].children.length===0)this.mount(e,true);
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
            e.group.userData = { id: e.spec.id, axial: e.spec.building.axial, azimuth: e.spec.building.azimuth, lod: e.lod, distance, asset: e.asset, transitioning: !!e.transition };
        }
        this.updateBatches();
        this.group.userData = { buildings: this.entries.map(e => e.group.userData) };
    }
    // Stable block/skyline levels share one draw per primitive. During the
    // short transition the individual meshes retain complementary dithering.
    private updateBatches() {
        const stable = this.entries.filter(e=>e.asset && !e.transition && e.lod>=2 && e.lod<4);
        const signature=this.entries.map(e=>`${e.asset}:${e.lod}:${!!e.transition}`).join('|');
        if(signature!==this.batchSignature){
            this.clearBatches();
            const groups=new Map<string,{entry:Entry;mesh:THREE.Mesh}[]>();
            for(const entry of stable) entry.levels[entry.lod].children.forEach((object,index)=>{
                if(!(object instanceof THREE.Mesh))return;
                const key=entry.spec.id+':'+entry.lod+':'+index;
                const items=groups.get(key)??[];items.push({entry,mesh:object});groups.set(key,items);
            });
            const matrix=new THREE.Matrix4();
            for(const items of groups.values()){
                const source=items[0].mesh;
                const clone=(m:THREE.Material)=>{const result=m.clone();if(result instanceof THREE.MeshStandardMaterial)result.emissiveIntensity=.03+(1-this.daylight)*.62;return result};
                const batch=new THREE.InstancedMesh(source.geometry,Array.isArray(source.material)?source.material.map(clone):clone(source.material),items.length);
                items.forEach(({entry,mesh},i)=>{entry.group.updateMatrix();mesh.updateMatrix();batch.setMatrixAt(i,matrix.multiplyMatrices(entry.group.matrix,mesh.matrix))});
                batch.instanceMatrix.needsUpdate=true;batch.computeBoundingSphere();batch.name='city-block-instances';batch.castShadow=true;batch.receiveShadow=true;
                this.group.add(batch);this.batches.push(batch);
            }
            this.batchSignature=signature;
        }
        for(const e of stable)e.levels[e.lod].visible=false;
    }
    private clearBatches(){
        for(const batch of this.batches){batch.removeFromParent();batch.dispose();for(const m of Array.isArray(batch.material)?batch.material:[batch.material])m.dispose()}
        this.batches=[];this.batchSignature='';
    }
    setDaylight(daylight: number, force=false) {
        if(!force && Math.abs(daylight-this.daylight)<.002)return;
        this.daylight = daylight;
        this.group.traverse(o => {
                if (!(o instanceof THREE.Mesh))
                    return;
                for (const m of Array.isArray(o.material) ? o.material : [o.material])
                    if (m instanceof THREE.MeshStandardMaterial)
                        m.emissiveIntensity = .03 + (1 - daylight) * .62;
            });
    }
    private clearEntry(e: Entry) { for (const g of e.levels) {
        g.traverse(o => { if (o instanceof THREE.Mesh) {
            if (!e.asset) o.geometry.dispose();
            for (const m of Array.isArray(o.material) ? o.material : [o.material])
                m.dispose();
        } });
        g.clear();
    } }
    private clear() { this.clearBatches(); for (const e of this.entries) {
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
