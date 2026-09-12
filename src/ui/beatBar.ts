import { closeEverything, createDropdownChip } from './dropdownLayer'
import { PLACE_DESTINATIONS, type PlaceVisitAction } from '../app/placeVisits'
import type { OutingAction } from '../app/neighborhoodRoute'

export type BeatBarAction = PlaceVisitAction | OutingAction | 'respawn-inner-wall' | 'respawn-old-town' |
  'respawn-overlook' | 'respawn-axis-end' | 'respawn-exterior' | 'rpm-coarse-decrement' |
  'rpm-coarse-increment' | 'audio-mute-toggle'
export type BeatBarSnapshot = {
  driving?: boolean; rpm: number; feltGravity: number; axisAvailable: boolean; oldTownAvailable: boolean
  raining: boolean; muted: boolean; availablePlaces: ReadonlySet<PlaceVisitAction>
}
export type BeatBarHandle = {
  destroy: () => void; setVisible: (visible: boolean) => void
  update: (snapshot: BeatBarSnapshot) => void
}

// One row per place. The prominent name starts guidance; the separate Go now
// action is labelled as an immediate visit, so the two cannot be mistaken.
const PLACE_ROWS: {label:string; guide?:BeatBarAction; visit?:BeatBarAction; available:PlaceVisitAction}[] = [
  {label:'Central Square',guide:'guide-square',visit:'respawn-inner-wall',available:'visit-car-share'},
  {label:'Café',guide:'guide-cafe',visit:'visit-cafe',available:'visit-cafe'},
  {label:'Park',guide:'guide-park',visit:'visit-park',available:'visit-park'},
  {label:'Your car',guide:'guide-car',available:'visit-car-share'},
  ...PLACE_DESTINATIONS.filter(p=>!['visit-cafe','visit-park'].includes(p.id)).map(p=>({label:p.label,visit:p.id,available:p.id}))
]
export const createBeatBar = (onAction:(action:BeatBarAction)=>void, mount:HTMLElement,
  onToggleRain?:()=>void, primary:HTMLElement=mount):BeatBarHandle => {
  const root=document.createElement('div');root.className='beat-bar'
  const places=createDropdownChip<never>('beat-btn beat-btn--places',[],()=>{},'Places')
  places.menu.classList.add('ui-panel','places-menu')
  const title=document.createElement('h2');title.textContent='Places'
  const hint=document.createElement('p');hint.className='ui-panel__hint';hint.textContent='Choose a place for directions. Go now skips the journey.'
  places.menu.append(title,hint)
  const select=(action:BeatBarAction,event:MouseEvent)=>{
    closeEverything();onAction(action)
    if(event.detail===0)places.chip.focus()
  }
  const rows=PLACE_ROWS.map(place=>{
    const row=document.createElement('div');row.className='place-row'
    const label=document.createElement(place.guide?'button':'span')
    label.className=place.guide?'place-guide':'place-label';label.textContent=place.label
    if(place.guide){
      label.setAttribute('aria-label',`Directions to ${place.label}`)
      label.addEventListener('click',e=>select(place.guide!,e as MouseEvent))
      const arrow=document.createElement('span');arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');label.append(arrow)
    }
    row.append(label)
    if(place.visit){
      const visit=document.createElement('button');visit.className='place-visit';visit.textContent='Go now'
      visit.setAttribute('aria-label',`Go now to ${place.label}`)
      visit.addEventListener('click',e=>select(place.visit!,e));row.append(visit)
    }
    places.menu.append(row);return {place,row,label}
  })
  const explore=createDropdownChip<BeatBarAction>('beat-btn beat-btn--travel',[
    {id:'respawn-inner-wall',label:'Surface · Central Square'},
    {id:'respawn-old-town',label:'Old Town'},
    {id:'respawn-overlook',label:'Overlook · above the city'},
    {id:'respawn-axis-end',label:'Axis · experience weightlessness'},
    {id:'respawn-exterior',label:'Exterior · see the whole colony'}
  ],onAction,'Explore')
  explore.menu.classList.add('ui-panel')
  const exploreHeading=document.createElement('h2');exploreHeading.textContent='Explore the colony';explore.menu.prepend(exploreHeading)
  const button=(label:string,action:()=>void)=>{
    const el=document.createElement('button');el.className='beat-btn';el.textContent=label
    el.addEventListener('pointerdown',e=>e.stopPropagation());el.addEventListener('click',action);root.append(el);return el
  }
  const spinLabel=document.createElement('span');spinLabel.className='environment-label';spinLabel.textContent='Spin';root.append(spinLabel)
  button('−',()=>onAction('rpm-coarse-decrement')).setAttribute('aria-label','Decrease spin')
  button('+',()=>onAction('rpm-coarse-increment')).setAttribute('aria-label','Increase spin')
  const rain=button('Rain',()=>onToggleRain?.())
  const sound=button('Sound on',()=>onAction('audio-mute-toggle'))
  primary.append(places.chip,explore.chip);mount.append(root)
  return {
    destroy(){places.destroy();explore.destroy();places.chip.remove();explore.chip.remove();root.remove()},
    setVisible(v){root.hidden=!v;places.chip.hidden=!v;explore.chip.hidden=!v},
    update(s){
      for(const {place,row,label} of rows){row.hidden=!s.availablePlaces.has(place.available);if(place.guide) (label as HTMLButtonElement).disabled=place.guide==='guide-car'&&!!s.driving}
      places.chip.hidden=s.availablePlaces.size===0
      for(const item of explore.menuItems){
        if(item.id==='respawn-old-town')item.element.hidden=!s.oldTownAvailable
        if(item.id==='respawn-axis-end')item.element.disabled=!s.axisAvailable
      }
      rain.classList.toggle('beat-btn--on',s.raining);rain.setAttribute('aria-pressed',String(s.raining))
      const text=s.muted?'Sound off':'Sound on';if(sound.textContent!==text)sound.textContent=text
      sound.setAttribute('aria-pressed',String(!s.muted))
    }
  }
}
