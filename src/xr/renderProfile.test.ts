import {expect,test} from 'bun:test'
import {xrRenderProfile} from './renderProfile'

test('Quest retains full reference resolution without MSAA',()=>{
  for(const tier of ['quest','phone','desktop'] as const){
    const profile=xrRenderProfile(tier,true)
    expect(profile.antialias).toBe(false)
    expect(profile.framebufferScale).toBe(1)
  }
})

test('headset comparison scales are bounded, with invalid values falling back to the default',()=>{
  for(const scale of ['0.7','0.85','1'])expect(xrRenderProfile('quest',false,scale).framebufferScale).toBe(Number(scale))
  for(const scale of [null,'','NaN','Infinity','0','0.69','1.01'])expect(xrRenderProfile('quest',false,scale).framebufferScale).toBe(1)
  expect(xrRenderProfile('desktop',false,'0.7').framebufferScale).toBe(1)
})

test('emulated Quest uses the standalone budget; other devices retain their rendering',()=>{
  expect(xrRenderProfile('quest',false).name).toBe('standalone')
  expect(xrRenderProfile('desktop',false)).toMatchObject({antialias:true,framebufferScale:1})
  expect(xrRenderProfile('phone',false)).toMatchObject({antialias:true,framebufferScale:1})
})
