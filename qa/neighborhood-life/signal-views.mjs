import {underpassPose} from './underpass-views.mjs'
export const signalViews=[
 {name:'approach',at:[-8.4/3200,300,1.8],aim:[-7.25/3200,317.39,4.7],ground:true},
 {name:'close',at:[-7.25/3200,314.5,4.69],aim:[-7.25/3200,317.39,4.69]},
 {name:'oblique',at:[-8.5/3200,313.9,5.6],aim:[-7.25/3200,317.39,4.69]},
 {name:'back',at:[-7.25/3200,320.3,4.69],aim:[-7.25/3200,317.39,4.69]},
 {name:'street',at:[15/3200,321.79,4.69],aim:[10.65/3200,321.79,4.69]},
 {name:'medium',at:[-7.25/3200,217.39,3],aim:[-7.25/3200,317.39,4.69]},
 {name:'far',at:[-7.25/3200,77.39,15],aim:[-7.25/3200,317.39,4.69]},
 {name:'night',at:[-8.4/3200,300,1.8],aim:[-7.25/3200,317.39,4.7],ground:true,phase:.02}
]
export const signalPose=view=>{
 const query=new URLSearchParams(underpassPose(view))
 // Free-flight URLs place the body; compensate for the 1.8 m eye offset.
 if(!view.ground){const [a,ax,h]=view.at;query.set('p',[Math.cos(a)*(3200-h+1.8),ax,Math.sin(a)*(3200-h+1.8)].join(','))}
 return query.toString()
}
