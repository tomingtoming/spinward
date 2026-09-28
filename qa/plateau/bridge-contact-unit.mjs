import assert from 'node:assert/strict'
import {WalkWorld} from './walking.js'
const ring=[[-10,-10],[10,-10],[10,10],[-10,10],[-10,-10]],road={rings:[ring],bounds:[-10,-10,10,10]}
const w=new WalkWorld({bounds:[-20,-20,20,20],axis:[-20,20],heights:[[0,0],[0,0]],terrainOrigin:[-20,-20],step:40,buildings:[],water:[],roads:[road],
 heightSupports:[{vertices:[[-4,-4,.12],[4,-4,.12],[4,4,2.12],[-4,4,2.12]],indices:[0,1,2,0,2,3]}]})
assert.equal(w.ground(9,0),.09)
assert.equal(w.ground(11,0),.035)
for(let x=-3.9;x<=3.9;x+=.3)for(let y=-3.9;y<=3.9;y+=.3)assert(Math.abs(w.ground(x,y)-(.12+(y+4)/4))<1e-9)
let state={x:0,y:-4,h:.12};for(let y=-3.9;y<=4;y+=.1){state=w.move(state,0,y-state.y);assert(Math.abs(state.y-y)<1e-9);assert(Math.abs(state.h-(.12+(y+4)/4))<1e-9)}
console.log('PASS actual bridge triangle interpolation, support boundary and ramp traversal')
