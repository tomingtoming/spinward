import * as THREE from "three";

import type { CityBuilding, CityRoad } from "./cityLayout";
import type { KenneyCarGeometryPack } from "./buildingAssets";

// Parked cars along the kerb (2026-09-03, 緻密さ①): the cheapest sign of
// life a street can have. One slot per parcel front, on the road the parcel
// faces, deterministic per parcel so a car never moves between relayouts.
// Near-field only (same scheme as intersectionFurniture): the parcels within
// PARKING_RANGE of the player are laid out, refreshed every REFOCUS metres.
//
// Rules: only fronts on arterial/local grid roads (alleys are service lanes);
// the car sits in the kerb lane just off the sidewalk, nose along the road.
// Arterial traffic runs in the inner lanes (cityscape laneOffset ≈ 0.22·w),
// so the kerb lane is free on both road kinds.

export const PARKING_RANGE_METERS = 300;
export const PARKING_REFOCUS_METERS = 60;
export const KERB_LANE_INSET = 1.35;
export const CAR_LENGTH_ALLOWANCE = 6.5;

export type ParkingSlot = {
  azimuth: number;
  axial: number;
  // Heading axis of the road: 'axial' on an avenue, 'tangent' on a street.
  along: "axial" | "tangent";
  isAvenue: boolean;
  roadKind: "arterial" | "local";
  // Direction the parked car faces (+1 = +axial / +tangent).
  facing: 1 | -1;
  variant: number;
  urban: number;
};

const TWO_PI = Math.PI * 2;
const wrapToPi = (angle: number) => {
  const wrapped = ((angle % TWO_PI) + TWO_PI) % TWO_PI;
  return wrapped > Math.PI ? wrapped - TWO_PI : wrapped;
};

// Deterministic 0..1 from a slot's surface position (no RNG consumed).
export const slotHash = (azimuth: number, axial: number, salt: number) => {
  const v =
    Math.sin(azimuth * 127.1 + axial * 0.0311 + salt * 7.77) * 43758.5453;
  return v - Math.floor(v);
};

export const parkingProbability = (building: CityBuilding) => {
  if (building.industrial) return 0.15;
  const urban = building.urban ?? 0.4;
  return 0.12 + 0.4 * urban;
};

const containingGridRoad = (
  azimuth: number,
  axial: number,
  roads: CityRoad[],
  radius: number,
): CityRoad | null => {
  for (const road of roads) {
    if (road.kind === "alley") continue;
    if (Math.abs(axial - road.axial) > road.axialLength * 0.5) continue;
    if (
      Math.abs(wrapToPi(azimuth - road.azimuth)) * radius >
      road.tangentWidth * 0.5
    )
      continue;
    return road;
  }
  return null;
};

// Pure: where this parcel's car would stand, or null if the parcel fronts no
// grid road (alleys) or the slot would not fit. `alongShift` moves the slot
// along the road from the parcel centre (a long frontage holds two cars).
export const parkingSlotFor = (
  building: CityBuilding,
  radius: number,
  gridRoads: CityRoad[],
  sidewalk: number,
  variantCount: number,
  alongShift = 0,
): ParkingSlot | null => {
  const { front, parcel } = building;
  if (front === undefined || parcel === undefined || radius <= 0) return null;
  const alongExtent =
    front.axis === "tangent" ? parcel.axialExtent : parcel.tangentExtent;
  if (alongExtent < CAR_LENGTH_ALLOWANCE) return null;

  // Parcel front edge (relative to the building centre) plus sidewalk and the
  // kerb-lane inset, along the front axis.
  let tangentOffset: number;
  let axialOffset: number;
  if (front.axis === "tangent") {
    tangentOffset =
      parcel.tangentOffset +
      front.side * (parcel.tangentExtent * 0.5 + sidewalk + KERB_LANE_INSET);
    axialOffset = parcel.axialOffset + alongShift;
  } else {
    axialOffset =
      parcel.axialOffset +
      front.side * (parcel.axialExtent * 0.5 + sidewalk + KERB_LANE_INSET);
    tangentOffset = parcel.tangentOffset + alongShift;
  }
  const azimuth = building.azimuth + tangentOffset / radius;
  const axial = building.axial + axialOffset;
  const road = containingGridRoad(azimuth, axial, gridRoads, radius);
  if (road === null) return null;
  const isAvenue = road.axialLength > road.tangentWidth;
  // The slot must run along the road it sits in: a parcel on an avenue
  // parks axially; a parcel on a street parks tangentially.
  const along: "axial" | "tangent" = isAvenue ? "axial" : "tangent";
  if ((front.axis === "tangent") !== isAvenue) return null;
  return {
    azimuth,
    axial,
    along,
    isAvenue,
    roadKind: road.kind === "arterial" ? "arterial" : "local",
    facing: slotHash(azimuth, axial, 2) < 0.5 ? 1 : -1,
    variant:
      Math.floor(slotHash(azimuth, axial, 3) * Math.max(1, variantCount)) %
      Math.max(1, variantCount),
    urban: building.urban ?? 0.4,
  };
};

// A frontage long enough for two cars gets two slots, a quarter-extent
// either side of the parcel centre; shorter ones get one at the centre.
export const parkingSlotsFor = (
  building: CityBuilding,
  radius: number,
  gridRoads: CityRoad[],
  sidewalk: number,
  variantCount: number,
): ParkingSlot[] => {
  const { front, parcel } = building;
  if (front === undefined || parcel === undefined) return [];
  const alongExtent =
    front.axis === "tangent" ? parcel.axialExtent : parcel.tangentExtent;
  const shifts =
    alongExtent >= CAR_LENGTH_ALLOWANCE * 2.2
      ? [-alongExtent * 0.25, alongExtent * 0.25]
      : [0];
  const out: ParkingSlot[] = [];
  for (const shift of shifts) {
    const slot = parkingSlotFor(
      building,
      radius,
      gridRoads,
      sidewalk,
      variantCount,
      shift,
    );
    if (slot !== null) out.push(slot);
  }
  return out;
};

export const isSlotOccupied = (slot: ParkingSlot, building: CityBuilding) =>
  slotHash(slot.azimuth, slot.axial, 4) < parkingProbability(building);

export const selectNearbyBuildings = (
  buildings: CityBuilding[],
  radius: number,
  focusAzimuth: number,
  focusAxial: number,
  rangeMeters: number = PARKING_RANGE_METERS,
): CityBuilding[] => {
  const out: CityBuilding[] = [];
  for (const b of buildings) {
    if (Math.abs(b.axial - focusAxial) > rangeMeters) continue;
    const tangent = Math.abs(wrapToPi(b.azimuth - focusAzimuth)) * radius;
    if (tangent > rangeMeters) continue;
    if (Math.hypot(tangent, b.axial - focusAxial) <= rangeMeters) out.push(b);
  }
  return out;
};

const outward = new THREE.Vector3();
const inward = new THREE.Vector3();
const tangentDir = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const basis = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const position = new THREE.Vector3();
const unitScale = new THREE.Vector3(1, 1, 1);
const matrix = new THREE.Matrix4();

export class ParkedCars {
  readonly group = new THREE.Group();

  private buildings: CityBuilding[] = [];
  private gridRoads: CityRoad[] = [];
  private radius = 0;
  private sidewalk = 0;
  private pack: KenneyCarGeometryPack | null = null;
  private meshes: THREE.InstancedMesh[] = [];
  private focusAzimuth = Number.NaN;
  private focusAxial = Number.NaN;
  private static readonly CAPACITY = 320;

  setPlan(
    buildings: CityBuilding[],
    roads: CityRoad[],
    radius: number,
    sidewalk: number,
  ) {
    this.buildings = buildings;
    this.gridRoads = roads.filter((r) => r.kind !== "alley");
    this.radius = radius;
    this.sidewalk = sidewalk;
    this.focusAzimuth = Number.NaN;
    this.focusAxial = Number.NaN;
  }

  // The Car Kit pack arrives asynchronously (cityscape loads it for the
  // traffic fleet); until then nothing is drawn.
  setPack(pack: KenneyCarGeometryPack | null) {
    if (pack === null || pack === this.pack) return;
    for (const mesh of this.meshes) {
      this.group.remove(mesh);
      mesh.dispose();
    }
    this.pack = pack;
    this.meshes = pack.cars.map((geometry) => {
      const mesh = new THREE.InstancedMesh(
        geometry,
        pack.material,
        ParkedCars.CAPACITY,
      );
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    });
    this.focusAzimuth = Number.NaN;
  }

  update(focusAzimuth: number, focusAxial: number) {
    if (
      this.radius <= 0 ||
      this.meshes.length === 0 ||
      this.buildings.length === 0
    )
      return;
    const moved =
      Number.isNaN(this.focusAzimuth) ||
      Math.hypot(
        Math.abs(wrapToPi(focusAzimuth - this.focusAzimuth)) * this.radius,
        focusAxial - this.focusAxial,
      ) > PARKING_REFOCUS_METERS;
    if (!moved) return;
    this.focusAzimuth = focusAzimuth;
    this.focusAxial = focusAxial;
    this.relayout();
  }

  // Headless probe (`?debug` → window.__spinward.parking).
  private stats = {
    nearby: 0,
    slots: 0,
    occupied: 0,
    drawn: 0,
    hasPack: false,
  };
  debugStats() {
    return {
      ...this.stats,
      hasPack: this.pack !== null,
      buildings: this.buildings.length,
      gridRoads: this.gridRoads.length,
    };
  }

  private relayout() {
    const counts = new Array<number>(this.meshes.length).fill(0);
    let slots = 0;
    let occupied = 0;
    const gap = Math.max(0.03, this.radius * 1.5e-5);
    const nearby = selectNearbyBuildings(
      this.buildings,
      this.radius,
      this.focusAzimuth,
      this.focusAxial,
    );
    for (const building of nearby) {
      for (const slot of parkingSlotsFor(
        building,
        this.radius,
        this.gridRoads,
        this.sidewalk,
        this.meshes.length,
      )) {
        slots += 1;
        if (!isSlotOccupied(slot, building)) continue;
        occupied += 1;
        const mesh = this.meshes[slot.variant];
        const index = counts[slot.variant];
        if (index >= ParkedCars.CAPACITY) continue;
        const cos = Math.cos(slot.azimuth);
        const sin = Math.sin(slot.azimuth);
        outward.set(cos, 0, sin);
        inward.copy(outward).multiplyScalar(-1);
        tangentDir.set(-sin, 0, cos);
        if (slot.along === "axial") {
          forward.set(0, slot.facing, 0);
        } else {
          forward.copy(tangentDir).multiplyScalar(slot.facing);
        }
        right.crossVectors(inward, forward);
        basis.makeBasis(right, inward, forward);
        quaternion.setFromRotationMatrix(basis);
        const surface = this.radius - 0.2 - (slot.isAvenue ? gap : 0);
        position.copy(outward).multiplyScalar(surface).setY(slot.axial);
        matrix.compose(position, quaternion, unitScale);
        mesh.setMatrixAt(index, matrix);
        counts[slot.variant] = index + 1;
      }
    }
    this.meshes.forEach((mesh, i) => {
      mesh.count = counts[i];
      mesh.instanceMatrix.needsUpdate = true;
    });
    this.stats = {
      nearby: nearby.length,
      slots,
      occupied,
      drawn: counts.reduce((a, b) => a + b, 0),
      hasPack: true,
    };
  }

  dispose() {
    for (const mesh of this.meshes) {
      this.group.remove(mesh);
      mesh.dispose();
    }
    this.meshes = [];
  }
}
