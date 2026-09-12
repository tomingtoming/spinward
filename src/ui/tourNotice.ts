import type { TourCard } from '../app/tourGuide'

/** DOM text stays readable at CSS-pixel size and out of the 3D view's centre.
 * XR keeps its existing spatial panel. Dismissal lasts for this card episode. */
export function createTourNotice() {
  const root=document.createElement('aside');root.className='tour-notice';root.hidden=true
  root.setAttribute('aria-label','Colony guide')
  const title=document.createElement('strong'),body=document.createElement('div'),close=document.createElement('button')
  close.textContent='×';close.setAttribute('aria-label','Dismiss guide')
  root.append(title,body,close);document.body.append(root)
  let key='',dismissed=false
  close.onclick=()=>{dismissed=true;root.hidden=true}
  return {
    update(card:TourCard|null,hidden:boolean){
      const next=card?card.title+'\n'+card.body.join('\n'):''
      if(next!==key){
        key=next;dismissed=false
        title.textContent=card?.title??''
        body.replaceChildren(...(card?.body??[]).map(line=>{const p=document.createElement('p');p.textContent=line;return p}))
      }
      root.hidden=hidden||!card||dismissed
    },
    destroy(){root.remove()}
  }
}
