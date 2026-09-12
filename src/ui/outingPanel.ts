import { createDropdownChip } from './dropdownLayer'
import type { OutingAction } from '../app/neighborhoodRoute'
import type { DriveMode } from '../gameplay/vehicle'

export function createOutingPanel(onAction:(action:OutingAction)=>void) {
  const root=document.createElement('aside');root.className='outing-panel';root.hidden=true;root.setAttribute('aria-label','Neighbourhood directions')
  const arrow=document.createElement('span');arrow.className='outing-arrow';arrow.textContent='↑';arrow.setAttribute('aria-hidden','true')
  const text=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('span')
  text.append(title,detail)
  const cancel=document.createElement('button');cancel.textContent='×';cancel.setAttribute('aria-label','Cancel directions');cancel.onclick=()=>onAction('guide-cancel')
  const park=document.createElement('button');park.textContent='Park';park.onclick=()=>onAction('park-car')
  const mode=createDropdownChip<OutingAction>('outing-mode',[{id:'drive-mode-toggle',label:'Switch Street / Experiment'}],onAction,'Street ▾')
  root.append(arrow,text,park,cancel);document.body.append(root)
  // Driving mode lives in the dock. The direction card is readable without
  // covering either touch stick, the drink action, or the centre of the view.
  return {root,modeChip:mode.chip, update(s:{label:string;detail:string;angle:number;active:boolean;driving:boolean;mode:DriveMode;canPark:boolean;hidden:boolean}) {
    root.hidden=s.hidden||!s.active
    if(title.textContent!==s.label)title.textContent=s.label
    if(detail.textContent!==s.detail)detail.textContent=s.detail
    arrow.style.transform=`rotate(${s.angle}rad)`;arrow.hidden=!Number.isFinite(s.angle)
    park.hidden=!s.canPark;cancel.hidden=!s.active
    mode.chip.hidden=s.hidden||!s.driving
    const modeLabel=s.mode==='street'?'Street ▾':'Experiment ▾'
    if(mode.chip.textContent!==modeLabel)mode.chip.textContent=modeLabel
  },dispose(){mode.destroy();root.remove()} }
}
