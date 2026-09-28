/** Credits remain attached to the city even when its source tiles stream out. */
export function createMetroCredits(roadData=null){
  const root=document.createElement('aside');root.setAttribute('aria-label','Map data sources');root.className='metro-source-credit'
  const style=document.createElement('style')
  style.textContent='.metro-source-credit{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:4;padding:5px 9px;border-radius:6px;background:#18211ee6;color:#c4cdc6;font:11px/1.4 system-ui;white-space:nowrap}.metro-source-credit a{color:inherit;text-underline-offset:2px}.metro-source-credit[hidden]{display:none}@media(max-width:700px){.metro-source-credit{bottom:80px;max-width:calc(100vw - 32px);white-space:normal;text-align:center}}'
  root.append(style,document.createTextNode('Map: '))
  for(const [i,[label,url]] of [['PLATEAU','https://www.mlit.go.jp/plateau/'],['GSI','https://maps.gsi.go.jp/development/ichiran.html'],['© OpenStreetMap contributors / ODbL','https://www.openstreetmap.org/copyright']].entries()){
    if(i)root.append(document.createTextNode(' · '))
    const a=document.createElement('a');a.textContent=label;a.href=url;a.target='_blank';a.rel='noopener noreferrer';root.append(a)
  }
  if(roadData){const a=document.createElement('a');a.textContent='Road data';a.href=roadData;a.download='spinward-roads.geojson';root.append(document.createTextNode(' · '),a)}
  root.hidden=true;document.body.append(root);return root
}
