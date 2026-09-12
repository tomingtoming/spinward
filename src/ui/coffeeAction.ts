// Separate C action leaves E for sitting/standing and vehicle entry.
export function createCoffeeAction(onActivate: () => void, reservedBottom: () => number) {
  const root=document.createElement('button');root.className='coffee-action';root.type='button';root.hidden=true
  const style=document.createElement('style')
  style.textContent=`.coffee-action{position:fixed;z-index:20;min-height:44px;box-sizing:border-box;left:50%;transform:translateX(-50%);max-width:calc(100vw - 24px);padding:11px 18px;border:1px solid #c5a47799;border-radius:8px;background:#342a20ef;color:#f8ead1;font:500 14px system-ui;box-shadow:0 4px 20px #0005;cursor:pointer}.coffee-action[hidden]{display:none}.coffee-action:disabled{cursor:default;color:#dbcdb9}.coffee-action:focus-visible{outline:2px solid #eed4a7;outline-offset:3px}`
  document.head.append(style);document.body.append(root)
  root.addEventListener('pointerdown',e=>e.stopPropagation())
  root.addEventListener('click',e=>{e.stopPropagation();onActivate();root.blur()})
  let previous='',bottom=-1
  return {
    update(prompt:{label:string;enabled:boolean}|null,touch:boolean){
      root.hidden=!prompt
      if(!prompt)return
      const label=prompt.enabled&&!touch?`C  ${prompt.label}`:prompt.label
      if(label!==previous){root.textContent=label;root.setAttribute('aria-label',prompt.label);previous=label}
      root.disabled=!prompt.enabled
      const b=Math.max(88,Math.ceil(reservedBottom()+12))
      if(b!==bottom){root.style.bottom=`${b}px`;bottom=b}
    },
    getReservedBottomHeight(){return root.hidden?0:window.innerHeight-root.getBoundingClientRect().top},
    dispose(){root.remove();style.remove()}
  }
}
