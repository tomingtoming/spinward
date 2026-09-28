// Count both app and separately hosted city traffic in the startup budget.
export function releaseEndpoints(appURL,dataURL){
  const app=new URL(appURL),data=new URL(dataURL??'/metro-data/',app)
  if(!['https:','http:'].includes(app.protocol)||!['https:','http:'].includes(data.protocol))throw Error('Expected HTTP endpoints')
  if(!data.pathname.endsWith('/'))data.pathname+='/'
  if(data.search||data.hash)throw Error('Data root must not contain a query or fragment')
  const appOrigin=app.origin,dataRoot=data.href
  const isApp=value=>new URL(value).origin===appOrigin
  const isData=value=>{const u=new URL(value);return u.origin===data.origin&&u.pathname.startsWith(data.pathname)}
  return{appOrigin,dataRoot,isApp,isData,owns:value=>isApp(value)||isData(value),wire:key=>new URL(key,data).href}
}
