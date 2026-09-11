import contract from '../../assets/blender/city-block.json';
import expansion from '../../assets/blender/city-block-expansion.json';
import type { CityBuilding } from './cityLayout';
export type BlockVolume = typeof contract.blocks[number]['volumes'][number];
export type BlockSpec = { id: string; building: CityBuilding; volumes: BlockVolume[]; wall: string; roof: string; offsetZ?: number };
export const CITY_BLOCK_PLACEMENTS: BlockSpec[] = [...contract.blocks.map(s=>({...s,building:s.building as CityBuilding})), ...expansion.map(p=>{const source=contract.blocks.find(s=>s.id===p.model)!;return {...source,building:p.building as CityBuilding,offsetZ:p.offsetZ,volumes:source.volumes.map(v=>({...v,z:v.z+p.offsetZ}))}})];
const bounds={minAz:Math.min(...CITY_BLOCK_PLACEMENTS.map(s=>s.building.azimuth)),maxAz:Math.max(...CITY_BLOCK_PLACEMENTS.map(s=>s.building.azimuth)),minAx:Math.min(...CITY_BLOCK_PLACEMENTS.map(s=>s.building.axial)),maxAx:Math.max(...CITY_BLOCK_PLACEMENTS.map(s=>s.building.axial))};
export const CITY_BLOCK = contract;
const key = (b: {
    azimuth: number;
    axial: number;
}) => `${b.azimuth.toFixed(9)}:${b.axial.toFixed(6)}`;
const disabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('cityBlock') === '0';
const pilotOnly=typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('cityBlock')==='pilot';
const specs = new Map((pilotOnly?CITY_BLOCK_PLACEMENTS.slice(0,3):CITY_BLOCK_PLACEMENTS).map(s => [key(s.building), s]));
export function cityBlockSpec(b: CityBuilding, radius: number) {
    if (radius !== contract.radius || disabled)
        return null;
    // Most city lots are outside the bounded pilot area: avoid string allocation
    // while scanning the far-city buffers. Exact matching still guards the rest.
    if (b.azimuth<bounds.minAz-1e-9 || b.azimuth>bounds.maxAz+1e-9 || b.axial<bounds.minAx-1e-6 || b.axial>bounds.maxAx+1e-6) return null;
    const s = specs.get(key(b));
    return s && Math.abs(s.building.width - b.width) < 1e-5 && Math.abs(s.building.depth - b.depth) < 1e-5 && Math.abs(s.building.height - b.height) < 1e-5 ? s : null;
}
export function cityBlockCollision(b: CityBuilding, s: BlockSpec, radius: number): CityBuilding[] {
    return s.volumes.map(v => ({ ...b, azimuth: b.azimuth + v.x / radius, axial: b.axial - v.z, width: v.w, depth: v.d, height: v.h, baseHeight: v.y - v.h / 2, collisionMargin: 0 }));
}
/** Distance to actual architectural volumes, including altitude and cylinder curvature. */
export function cityBlockDistance(s: BlockSpec, radius: number, focus: {
    azimuth: number;
    axial: number;
    altitude: number;
}) {
    const a = focus.azimuth - s.building.azimuth, r = radius - focus.altitude;
    const x = r * Math.sin(a), y = radius - r * Math.cos(a), z = s.building.axial - focus.axial;
    return Math.min(...s.volumes.map(v => Math.hypot(Math.max(0, Math.abs(x - v.x) - v.w / 2), Math.max(0, Math.abs(y - v.y) - v.h / 2), Math.max(0, Math.abs(z - v.z) - v.d / 2))));
}
export function selectCityBlockLod(distance: number, size: number, previous = 3, pixelsPerRadian = 935) {
    // The silhouette remains geometry until it is under two pixels. Detail levels
    // preserve the same volume recipe; thresholds include exit hysteresis.
    if (distance <= (previous === 0 ? 30 : 25))
        return 0;
    if (distance <= (previous <= 1 ? 144 : 120))
        return 1;
    if (distance <= (previous <= 2 ? 690 : 600))
        return 2;
    if (size * pixelsPerRadian / Math.max(1, distance) > (previous <= 3 ? 1.7 : 2))
        return 3;
    return 4;
}
