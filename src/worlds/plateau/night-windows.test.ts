import {test,expect} from 'bun:test'
import {Color,Mesh,MeshStandardMaterial,BufferGeometry,ShaderLib} from 'three'
import {collectBuildingLight,ROOM_MEAN_EXPOSURE} from './night-windows.js'
import {NightField} from './metro-night.js'

test('distant window radiance is an area reduction of lit panes, not new occupancy',()=>{
  const rows=[{id:'a',walls:[{length:10,base:2,top:12}]},{id:'b',walls:[{length:5,base:0,top:6}]}]
  const panes=[{id:'a',kind:'window',width:2,height:2,light:{colour:'#ffc98c',strength:.36}},
    {id:'a',kind:'window',width:2,height:2,light:{colour:'#dceaff',strength:0}}]
  const result=collectBuildingLight(rows,panes,c=>new Color(c).toArray())
  expect(result[0].panes).toBe(1)
  expect(result[0].mean[0]).toBeCloseTo(.36*4*ROOM_MEAN_EXPOSURE/100,8)
  expect(result[0].mean[0]).toBeGreaterThan(result[0].mean[2])
  expect(result[1].mean).toEqual([0,0,0])
})

test('night patch preserves ownership shader, and daylight contributes zero',()=>{
  const field=new NightField({}),m=new Mesh(new BufferGeometry(),new MeshStandardMaterial())
  m.material.onBeforeCompile=s=>{s.uniforms.existing={value:1};s.fragmentShader+='\n// ownership-discard'}
  field.patch(m,{name:'buildings',attributes:{position:new Float32Array([0,0,0,1,0,0,1,0,2])}})
  const shader={uniforms:{},vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader}
  m.material.onBeforeCompile(shader,null)
  expect(shader.uniforms.existing.value).toBe(1)
  expect(shader.fragmentShader).toContain('ownership-discard')
  field.setDaylight(1);expect(shader.uniforms.metroNight.value).toBe(0)
  field.ready=true;field.update(.5);field.setDaylight(0);expect(shader.uniforms.metroNight.value).toBe(1)
  field.dispose();m.geometry.dispose();m.material.dispose()
})
