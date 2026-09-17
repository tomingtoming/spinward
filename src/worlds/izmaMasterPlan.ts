/** Authored urban design for Spinward, 2026-09-17.
 * An original construction history and geography, not a canonical Izma map.
 * X is metres across a land strip; Y is metres along the cylinder. */
export type ColonyUse = 'mixed' | 'housing' | 'civic' | 'campus' | 'industry' | 'farming' | 'park' | 'utility'
export type ColonyFabric = 'river-town' | 'terrace-lanes' | 'station-centre' | 'campus' | 'works' | 'field-villages' | 'water-park' | 'service'
export type ColonyDistrict = {
  id: string; band: number; name: string; axial: [number, number]
  centre: [number, number]; use: ColonyUse; fabric: ColonyFabric
  storeys: [number, number]; era: 'founding' | 'growth' | 'renewal' | 'infrastructure'
  // Fractional land allocation, not population or floor-area claims.
  mix: { housing: number; employment: number; public: number; landscape: number }
}
export type ColonyNode = { id: string; band: number; xy: [number, number]; role: 'centre' | 'station' | 'interchange' | 'transfer' | 'road' }
export type ColonyRoute = { id: string; kind: 'rail' | 'arterial' | 'expressway' | 'local' | 'walk' | 'transfer'; nodes: string[]; width: number }

const mixes: Record<ColonyUse, ColonyDistrict['mix']> = {
  mixed: { housing: .4, employment: .28, public: .12, landscape: .2 },
  housing: { housing: .56, employment: .1, public: .12, landscape: .22 },
  civic: { housing: .23, employment: .29, public: .25, landscape: .23 },
  campus: { housing: .24, employment: .29, public: .2, landscape: .27 },
  industry: { housing: .13, employment: .58, public: .09, landscape: .2 },
  farming: { housing: .1, employment: .12, public: .08, landscape: .7 },
  park: { housing: .08, employment: .06, public: .14, landscape: .72 },
  utility: { housing: 0, employment: .65, public: .1, landscape: .25 }
}

type DistrictRow = [string, string, number, number, number, number, ColonyUse, ColonyFabric, number, number, ColonyDistrict['era']]
// Unequal districts and offset centres are drawn from their intended uses.
// They are not indexed into, or warped from, the previous city's street grid.
const rows: DistrictRow[][] = [
  [
    ['a-port', '南端の玄関と工房', -18500, -13500, -640, -16300, 'industry', 'works', 2, 8, 'founding'],
    ['a-old-town', '川町旧市街', -13500, -6000, -290, -9400, 'mixed', 'river-town', 2, 6, 'founding'],
    ['a-river', '川沿い段丘の街', -6000, 2500, -125, -80, 'housing', 'terrace-lanes', 2, 5, 'growth'],
    ['a-civic', '中央駅と市民地区', 2500, 8500, 570, 5800, 'civic', 'station-centre', 4, 16, 'renewal'],
    ['a-upland', '北丘住宅地', 8500, 14500, -570, 11400, 'housing', 'terrace-lanes', 2, 8, 'growth'],
    ['a-water', '上流の貯水公園', 14500, 18500, 80, 16300, 'park', 'water-park', 1, 3, 'infrastructure']
  ],
  [
    ['b-workshop', '技術工房と職住地区', -18500, -13000, 710, -15800, 'industry', 'works', 2, 7, 'growth'],
    ['b-campus', '大学と医療の街', -13000, -6800, -590, -10200, 'campus', 'campus', 3, 10, 'growth'],
    ['b-station', '新都心駅前', -6800, -1800, 490, -4200, 'mixed', 'station-centre', 5, 22, 'renewal'],
    ['b-housing', '団地と近隣商店街', -1800, 5200, -320, 2200, 'housing', 'terrace-lanes', 3, 10, 'growth'],
    ['b-commons', '運動公園と水辺', 5200, 11200, 350, 7900, 'park', 'water-park', 1, 4, 'growth'],
    ['b-north', '北の新市街', 11200, 18500, -460, 14600, 'housing', 'station-centre', 2, 9, 'renewal']
  ],
  [
    ['c-cargo', '貨物口と整備地区', -18500, -14200, -650, -16900, 'industry', 'works', 1, 5, 'infrastructure'],
    ['c-production', '生産工房の街', -14200, -8500, 570, -11600, 'industry', 'works', 2, 6, 'founding'],
    ['c-fields', '農園と集落', -8500, -1000, -480, -4700, 'farming', 'field-villages', 1, 3, 'founding'],
    ['c-market', '食の市場と田園市街', -1000, 4800, 290, 1600, 'mixed', 'river-town', 2, 5, 'growth'],
    ['c-orchards', '果樹園と調整池', 4800, 12800, -420, 8400, 'farming', 'field-villages', 1, 3, 'growth'],
    ['c-forest', '水源林と環境設備', 12800, 18500, 500, 15800, 'park', 'water-park', 1, 3, 'infrastructure']
  ]
]

export const IZMA_DISTRICTS: ColonyDistrict[] = rows.flatMap((band, index) => band.map(
  ([id, name, from, to, x, y, use, fabric, low, high, era]) => ({ id, band: index, name,
    axial: [from, to], centre: [x, y], use, fabric, storeys: [low, high], era, mix: { ...mixes[use] } })))

const nodes: ColonyNode[] = []
const routes: ColonyRoute[] = []
const addNode = (id: string, band: number, xy: [number, number], role: ColonyNode['role']) => {
  nodes.push({ id, band, xy, role }); return id
}
const addRoute = (id: string, kind: ColonyRoute['kind'], ns: string[], width: number) => routes.push({ id, kind, nodes: ns, width })
const transferYs = [-19000, 6500, 19000]
const railX = [[-890, -810, -920, -580, -860, -680], [1010, 780, 980, 660, 810, 690], [-990, -760, -800, -770, -860, -640]]
const motorwayX = [1320, -1320, 1320]

for (let band = 0; band < 3; band++) {
  const districts = IZMA_DISTRICTS.filter(d => d.band === band)
  const stations: string[] = [], centres: string[] = [], interchanges: string[] = []
  for (const [i, d] of districts.entries()) {
    const centre = addNode(d.id, band, d.centre, 'centre')
    const station = addNode(d.id + '-station', band, [railX[band][i], d.centre[1]], 'station')
    const interchange = addNode(d.id + '-ic', band, [motorwayX[band], d.centre[1] + 380], 'interchange')
    stations.push(station); centres.push(centre); interchanges.push(interchange)
    // Explicit station forecourt and motorway access. The ramps, crossings,
    // and bridge clearances still need geometric design before driving.
    addRoute(d.id + '-station-road', 'local', [station, centre], 10)
    addRoute(d.id + '-access', 'arterial', [centre, interchange], 16)
    // Each centre has a different side-street structure: no repeated closed
    // loop on every parcel, and no all-to-all connection of district centres.
    const side = d.centre[0] > 0 ? -1 : 1
    const branch = addNode(d.id + '-neighbourhood', band, [d.centre[0] + side * 340, d.centre[1] + 540], 'road')
    addRoute(d.id + '-neighbourhood-road', 'local', [centre, branch], d.fabric === 'works' ? 12 : 7)
    if (d.fabric === 'campus' || d.fabric === 'station-centre') {
      const park = addNode(d.id + '-square', band, [d.centre[0] + side * 520, d.centre[1] - 460], 'road')
      addRoute(d.id + '-campus-loop', 'local', [centre, park, branch], 9)
    } else {
      const lane = addNode(d.id + '-garden', band, [d.centre[0] - side * 250, d.centre[1] - 360], 'road')
      addRoute(d.id + '-garden-lane', 'local', [centre, lane], 6)
    }
  }
  for (const [i, y] of transferYs.entries()) {
    const station = addNode(`band-${band}-transfer-${i}`, band, [band === 1 ? 820 : -820, y], 'transfer')
    const motorway = addNode(`band-${band}-jct-${i}`, band, [motorwayX[band], y], 'interchange')
    stations.push(station); interchanges.push(motorway)
    addRoute(`band-${band}-transfer-access-${i}`, 'arterial', [station, motorway], 20)
  }
  const order = (ids: string[]) => ids.sort((a, b) => nodes.find(n => n.id === a)!.xy[1] - nodes.find(n => n.id === b)!.xy[1])
  addRoute(`band-${band}-rail`, 'rail', order(stations), 12)
  addRoute(`band-${band}-expressway`, 'expressway', order(interchanges), 24)
  addRoute(`band-${band}-town-road`, 'arterial', order(centres), 18)
}

// Three separate transfer levels: two end galleries and one central bridge.
// These are graph reservations; a line crossing another line is not a JCT.
for (let i = 0; i < 3; i++) for (let band = 0; band < 3; band++) {
  addRoute(`transfer-${i}-${band}`, 'transfer', [`band-${band}-transfer-${i}`, `band-${(band + 1) % 3}-transfer-${i}`], 28)
  addRoute(`expressway-transfer-${i}-${band}`, 'expressway', [`band-${band}-jct-${i}`, `band-${(band + 1) % 3}-jct-${i}`], 24)
}

export const IZMA_MASTER_PLAN = {
  version: 1,
  status: 'authored master-plan blockout; full landscape and transport implementation pending',
  radius: 3200, span: 40000, landArcRadians: Math.PI / 3,
  edgeReserve: 125, endReserve: 1500,
  coordinates: 'x = strip-local tangent metres, y = axial metres, height = inward above hull',
  bands: [
    { id: 0, name: '川町帯', nameEn: 'River towns', azimuth: 0,
      premise: '移住時に持ち込んだ川町の街区、段丘住宅、その後の駅前更新が重なる。' },
    { id: 1, name: '学園・新市街帯', nameEn: 'Campus and new towns', azimuth: Math.PI * 2 / 3,
      premise: '第二期の大学・医療・集合住宅を先に造成し、駅前に用途混在の市街が育った。' },
    { id: 2, name: '生産・田園帯', nameEn: 'Production and garden towns', azimuth: Math.PI * 4 / 3,
      premise: '物流と環境設備、農園を先行し、仕事場の近くに集落と市場を置いた。' }
  ],
  districts: IZMA_DISTRICTS, nodes, routes,
  // Water runs towards negative axial Y, then returns through a pumped pipe.
  // Water-circulation concept only; no hydraulic capacity or flow simulation.
  water: [
    { band: 0, name: '川町水系', width: 38, bankWidth: 135,
      reach: [[-90, -18200, .4], [-320, -14100, .7], [170, -10500, .9], [-260, -5600, 1.1], [-85, -400, 1.4], [12, -80, 1.4], [-35, 400, 1.4], [250, 4400, 4.5], [-210, 9200, 15], [100, 14200, 31], [-150, 18200, 48]] },
    { band: 1, name: '学園水系', width: 26, bankWidth: 105,
      reach: [[-160, -18200, 1], [160, -13600, 3], [-190, -8800, 6], [-130, -2500, 10], [190, 2900, 18], [-170, 7100, 28], [50, 12800, 43], [-120, 18200, 61]] },
    { band: 2, name: '田園水系', width: 46, bankWidth: 175,
      reach: [[70, -18200, 2], [-80, -13900, 4], [60, -7200, 8], [-150, -1600, 14], [90, 3600, 24], [-90, 9200, 41], [180, 14800, 59], [50, 18200, 76]] }
  ],
  hills: [
    { band: 0, centre: [-1120, 1500], size: [600, 2400], height: 48 },
    { band: 0, centre: [1120, -10500], size: [540, 3400], height: 28 },
    { band: 0, centre: [-980, 11700], size: [620, 2800], height: 64 },
    { band: 1, centre: [1120, -10200], size: [470, 2300], height: 32 },
    { band: 1, centre: [-1050, 3300], size: [500, 2900], height: 37 },
    { band: 2, centre: [1100, 14200], size: [580, 2600], height: 46 }
  ],
  protectedStudy: { band: 0, bounds: [-320, -400, 320, 400], routeMetres: 420.2 },
  // Geometry detail and final amounts remain subject to measured rendering cost.
  delivery: { tileMetres: 512, renderLODs: 3, collisionSource: 'exported near triangles', lightPool: 6 }
} as const

export function colonyPoint(band: number, x: number, y: number, height: number): [number, number, number] {
  const a = IZMA_MASTER_PLAN.bands[band].azimuth + x / IZMA_MASTER_PLAN.radius
  const r = IZMA_MASTER_PLAN.radius - height
  return [Math.cos(a) * r, y, Math.sin(a) * r]
}
