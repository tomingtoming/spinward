import fs from 'node:fs/promises'
import path from 'node:path'
import {planCity} from '../../src/objects/cityLayout'
import {rebuildNativeDistricts} from '../../src/objects/nativeDistricts'
import {captureBandPublicPlaces} from '../../src/objects/bandPublicPlaces'

const output=process.env.OUTPUT_FILE
if(!output||!path.isAbsolute(output))throw Error('OUTPUT_FILE must be absolute')
const radius=3200,length=40000,maxBuildings=16000,city=planCity({radius,length,maxBuildings})
rebuildNativeDistricts(city,radius)
await fs.mkdir(path.dirname(output),{recursive:true})
await fs.writeFile(output,JSON.stringify({origin:'ai',created:'2026-09-14',source:'Existing inhabited planCity + rebuildNativeDistricts; public destination contracts before band migration',
  radius,length,maxBuildings,places:captureBandPublicPlaces(city,radius)},null,2)+'\n')
