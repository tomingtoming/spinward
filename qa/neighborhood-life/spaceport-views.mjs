import {Matrix4,Quaternion,Vector3} from 'three'
export const spaceportViews=[
 {name:'occupied',at:[478,-20248,16],aim:[456,-20208,0]},
 {name:'empty',at:[20,-20241,468],aim:[0,-20208,456]},
 {name:'opposite',at:[-479,-20245,14],aim:[-456,-20208,0]},
 {name:'empty-opposite',at:[18,-20239,-469],aim:[0,-20208,-456]},
 {name:'contact',at:[464,-20217,4],aim:[456,-20208,0]},
 {name:'night',at:[478,-20248,16],aim:[456,-20208,0],phase:.02},
 {name:'medium',at:[540,-20304,68],aim:[456,-20208,0]},
 {name:'far',at:[830,-20900,630],aim:[0,-20020,0]},
 {name:'small',preset:'playground',at:[23,-96,8],aim:[10.5,-77,0]},
 {name:'small-empty',preset:'playground',at:[8,-78,17],aim:[0,-69,10.5]}
]
export function spaceportPose(v){
 const at=new Vector3(...v.at),q=new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(at,new Vector3(...v.aim),new Vector3(0,0,1)))
 return `preset=${v.preset??'izma'}&m=f&rpm=0&p=${at.toArray()}&q=${q.toArray()}&t=${v.phase??.42}`
}
