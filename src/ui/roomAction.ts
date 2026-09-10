// One contextual action, shared by mouse and touch. E remains available while
// pointer-locked; ordinary car entry retains that key away from a room bench.
export function createRoomAction(onActivate:()=>void, reservedBottom:()=>number) {
  const button=document.createElement('button')
  button.className='room-action';button.hidden=true;button.type='button'
  const style=document.createElement('style')
  style.textContent=`.room-action{position:fixed;z-index:20;left:50%;bottom:max(88px,env(safe-area-inset-bottom));transform:translateX(-50%);padding:12px 20px;border:1px solid #bba88780;border-radius:8px;background:#172422ed;color:#f7ead3;font:500 14px system-ui;box-shadow:0 4px 24px #0005;cursor:pointer;white-space:nowrap}.room-action[hidden]{display:none}.room-action:hover{background:#30443c}.room-action:focus-visible{outline:2px solid #eed4a7;outline-offset:3px}`
  document.head.append(style);document.body.append(button)
  button.addEventListener('pointerdown',e=>e.stopPropagation())
  button.addEventListener('click',e=>{e.stopPropagation();onActivate();button.blur()})
  let previous='', bottom=-1
  return {
    update(label:string|null,seated:boolean,hidden:boolean,touch:boolean){
      const text=seated?'Stand up':label?`Sit · ${label}`:''
      const next=text&&!touch?`E  ${text}`:text
      if(next!==previous){button.textContent=next;button.setAttribute('aria-label',text);previous=next}
      button.hidden=hidden||!text
      if(!button.hidden){
        const nextBottom=Math.max(88,Math.ceil(reservedBottom()+12))
        if(nextBottom!==bottom){button.style.bottom=`${nextBottom}px`;bottom=nextBottom}
      }
    },
    getReservedBottomHeight(){return button.hidden?0:window.innerHeight-button.getBoundingClientRect().top},
    dispose(){button.remove();style.remove()}
  }
}
