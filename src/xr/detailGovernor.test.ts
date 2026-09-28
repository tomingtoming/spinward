import {expect,test} from 'bun:test'
import {createXRDetailGovernor} from './detailGovernor'

function fixture(hz=72){
  const governor=createXRDetailGovernor();let now=0,level=0
  return {governor,run(seconds:number,step=1000/hz,ready=true){const end=now+seconds*1000;while(now<end){now+=step;level=governor.frame(now,true,ready,hz)}return level},
    gap(ms:number){now+=ms;return governor.frame(now,true,true,hz)},exit(){return governor.frame(now,false,false,hz)}}
}
test('sustained misses lower detail at 72 and 90 Hz without responding to a single hitch',()=>{
  for(const rate of [72,90]){
    const f=fixture(rate);expect(f.run(4)).toBe(0)
    f.gap(100);expect(f.run(3)).toBe(0)
    expect(f.run(5,2000/rate)).toBe(1)
    expect(f.run(8,2000/rate)).toBe(2)
    expect(f.run(8,2000/rate)).toBe(2)
    expect(f.governor.diagnostics().reason).toBe('detail-floor')
  }
})
test('quality recovers slowly with bounded steps and resets on exit',()=>{
  const f=fixture();expect(f.run(16,1000/36)).toBe(2)
  expect(f.run(10)).toBe(2);expect(f.run(12)).toBe(1)
  expect(f.run(21)).toBe(0)
  expect(f.run(9,1000/36)).toBe(1);expect(f.exit()).toBe(0)
  expect(f.run(2,1000/36)).toBe(0)
})
test('waiting, hidden sessions and long suspended gaps provide no downgrade evidence',()=>{
  const f=fixture();expect(f.run(20,1000/36,false)).toBe(0)
  expect(f.run(5)).toBe(0)
  f.gap(30000);expect(f.run(3,1000/36)).toBe(0)
})
test('mixed transient stalls and a changed refresh target do not cause oscillation',()=>{
  const f=fixture();f.run(4)
  for(let i=0;i<4;i++){f.run(1,1000/36);f.run(4)}
  expect(f.governor.diagnostics().level).toBe(0)
  const g=createXRDetailGovernor();for(let t=0;t<5000;t+=1000/90)g.frame(t,true,true,90)
  for(let t=5000;t<10000;t+=1000/72)g.frame(t,true,true,72)
  expect(g.diagnostics().level).toBe(0)
})
