import {test,expect} from 'bun:test'
import {Vector3} from 'three'
import {ObstructionLights,ROOF_SUPPORT_LIMIT} from './obstruction-lights.js'
import {surfacePoint} from './surface-frame.js'

test('roof supports and distant points share the same curved source anchor in all bands',()=>{
  const study={radius:3200,samples:[0,1,2].map(band=>({id:String(band),band,anchor:{local:[0,0]}}))}
  const manifest={supportHeightM:.6,bands:Object.fromEntries(study.samples.map(s=>[s.id,[[0,0,100]]]))}
  const lights=new ObstructionLights(study,manifest)
  for(const [i,s] of study.samples.entries()){
    const row=lights.rows[i],point=new Vector3(...surfacePoint(3200,s,'colony',0,0,100.6))
    expect(row.head.distanceTo(point)).toBeLessThan(.00001)
    expect(row.head.distanceTo(row.base)).toBeCloseTo(.6)
    lights.update(point);expect(lights.diagnostics().supports).toBe(1)
  }
  expect(lights.diagnostics().maxSupports).toBe(ROOF_SUPPORT_LIMIT)
  lights.setDaylight(0);expect(lights.points.visible).toBe(true)
  lights.setDaylight(1);expect(lights.points.visible).toBe(false);expect(lights.heads.material.emissiveIntensity).toBe(0)
  lights.dispose()
})
