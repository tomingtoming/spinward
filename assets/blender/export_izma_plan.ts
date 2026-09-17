import { IZMA_MASTER_PLAN } from '../../src/worlds/izmaMasterPlan'

// Run from any directory: bun /absolute/path/assets/blender/export_izma_plan.ts
const target = new URL('./izma-colony-plan.json', import.meta.url)
await Bun.write(target, JSON.stringify(IZMA_MASTER_PLAN, null, 2) + '\n')
console.log({ output: target.pathname, districts: IZMA_MASTER_PLAN.districts.length,
  nodes: IZMA_MASTER_PLAN.nodes.length, routes: IZMA_MASTER_PLAN.routes.length })
