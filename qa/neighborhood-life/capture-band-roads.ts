import {proposedBandLand} from '../../src/objects/bandLand'
import {proposedBandExpressway} from '../../src/objects/bandExpresswayLand'
import {planBandTransport} from '../../src/objects/bandExpressway'
import {prepareBandStreetGeometry} from '../../src/objects/bandStreetGeometry'
import {resolve} from 'node:path'
const transport=planBandTransport(proposedBandLand(),proposedBandExpressway())
const geometry=prepareBandStreetGeometry(transport.surface)
if(geometry.remaining.sharp.length||geometry.remaining.short.length)throw Error('Unresolved band road geometry')
await Bun.write(resolve('assets/planning/band-roads.json'),JSON.stringify({version:1,radius:3200,length:40000,roads:geometry.roads})+'\n')
console.log(`Captured ${geometry.roads.length} roads from the whole-band plan`)
