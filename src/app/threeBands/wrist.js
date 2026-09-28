import * as T from 'three'

export class StudyWrist{
  constructor(leftController,rightController,onAction){
    this.canvas=document.createElement('canvas');this.canvas.width=440;this.canvas.height=520
    this.ctx=this.canvas.getContext('2d');this.texture=new T.CanvasTexture(this.canvas);this.texture.colorSpace=T.SRGBColorSpace
    this.mesh=new T.Mesh(new T.PlaneGeometry(.22,.26),new T.MeshBasicMaterial({map:this.texture,side:T.DoubleSide,toneMapped:false}))
    // Grip-space conventions differ between controller profiles. Use the actual target-ray
    // frame for orientation, so raising/tilting the left controller presents a readable face.
    // Keep every button above the tracked hand and sleeve, including the
    // bottom transit action. The panel still follows the controller's pose.
    this.mesh.position.set(.04,.19,.08);this.mesh.name='study-wrist';leftController.add(this.mesh)
    this.right=rightController;this.onAction=onAction;this.ray=new T.Raycaster();this.hover=null
    this.buttons=['tokyo','tama','azumino','transit'].map((id,i)=>({id,x:24,y:104+i*96,w:392,h:80}))
    this.mainButtons=this.buttons;this.page='main';this.destinationIndex=0
    this.line=new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(),new T.Vector3(0,0,-.8)]),new T.LineBasicMaterial({color:0x65c4bd}))
    this.line.visible=false;rightController.add(this.line)
  }
  update(active,region,walking){
    this.mesh.visible=active;if(!active){this.hover=null;this.line.visible=false;return}
    if(!this.navigation)this.page='main'
    const navigation=!!this.navigation,destination=this.navigation?.data.destinations[this.destinationIndex]
    this.buttons=this.page==='main'?[...this.mainButtons,...(navigation?[{id:'destinations',x:248,y:12,w:168,h:54}]:[])]:[
      {id:'back',x:290,y:12,w:126,h:54},{id:'previous',x:24,y:104,w:188,h:80},{id:'next',x:228,y:104,w:188,h:80},
      ...['guide:'+destination.id,'travel:'+destination.id,'home'].map((id,i)=>({id,x:24,y:200+i*96,w:392,h:80}))]
    this.right.updateWorldMatrix(true,false);this.mesh.updateWorldMatrix(true,false)
    this.ray.ray.origin.setFromMatrixPosition(this.right.matrixWorld)
    this.ray.ray.direction.set(0,0,-1).transformDirection(this.right.matrixWorld)
    const hit=this.ray.intersectObject(this.mesh,false)[0];this.hover=null
    if(hit?.uv){const x=hit.uv.x*440,y=(1-hit.uv.y)*520;this.hover=this.buttons.find(b=>x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h)?.id??null}
    this.line.visible=!!hit
    if(hit)this.line.scale.z=hit.distance/.8
    const status=this.transport?.riding?this.transport.prompt:navigation&&walking?this.navigation.status:''
    const signature=`${region}/${walking}/${this.hover}/${this.page}/${this.destinationIndex}/${status}/${navigation?this.navigation.location:''}`;if(signature===this.signature)return;this.signature=signature
    const c=this.ctx;c.fillStyle='#172f31';c.fillRect(0,0,440,520)
    c.fillStyle='#e5eee8';c.font='600 25px system-ui';c.fillText(this.page==='main'?'SPINWARD':'行き先を選ぶ',26,44)
    c.font='18px system-ui';c.fillStyle='#b4cbc3';c.fillText(this.page==='main'?((this.transport?.riding||this.navigation?.goal&&navigation)?status:walking?'左スティックで歩く':'街の模型'):destination.label,26,84,388)
    const labels={tokyo:'東京 · 東高円寺',tama:'多摩センター',azumino:'安曇野 · 柏矢町',walk:walking?'模型に戻る':'地上を歩く',transit:this.transport?.riding?'連絡線から降りる':'連絡線に乗る',jump:'ジャンプ',daylight:'昼 / 夜',destinations:'行き先',back:'閉じる',previous:'← 前',next:'次 →',home:{tokyo:'東高円寺へ戻る',tama:'多摩センターへ戻る',azumino:'柏矢町へ戻る'}[region]}
    for(const b of this.buttons){c.fillStyle=this.hover===b.id?'#477b72':region===b.id?'#31544f':'#244144';c.fillRect(b.x,b.y,b.w,b.h);c.fillStyle='#f3f6eb';c.font='25px system-ui';c.fillText(labels[b.id]??(b.id.startsWith('guide:')?'経路を案内':'ここへ移動'),b.x+20,b.y+b.h*.62,b.w-30)}
    if(navigation&&walking){c.font='18px system-ui';c.fillStyle='#b4cbc3';c.fillText(this.navigation.location??'',26,503,388)}
    this.texture.needsUpdate=true
  }
  select(){
    if(!this.hover)return false
    if(this.hover==='destinations')this.page='destinations'
    else if(this.hover==='back')this.page='main'
    else if(['previous','next'].includes(this.hover))this.destinationIndex=(this.destinationIndex+(this.hover==='next'?1:-1)+this.navigation.data.destinations.length)%this.navigation.data.destinations.length
    else{this.onAction(this.hover);if(this.hover.startsWith('guide:')||this.hover==='home')this.page='main'}
    return true
  }
  trackingTarget(id,rig){
    const b=this.buttons.find(b=>b.id===id);if(!b)throw Error('Unknown wrist action')
    const p=new T.Vector3(((b.x+b.w/2)/440-.5)*.22,(.5-(b.y+b.h/2)/520)*.26,0)
    return rig.worldToLocal(this.mesh.localToWorld(p)).toArray()
  }
}
