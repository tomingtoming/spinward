// A bounded 1 m irradiance patch replaces dozens of per-fragment light loops.
// Only the view's 256 m neighbourhood is rebuilt, after an 8 m movement or a
// source-recipe change. GPU work is one filtered texture sample per pixel.
export const LOCAL_LIGHT_SIZE=256
export function bakeLocalLight(data,work,bounds,sources){
  const size=LOCAL_LIGHT_SIZE;work.fill(0);data.fill(0)
  for(const source of sources){
    const {x,y,radius,colour}=source,reach=radius+(source.width??0)*.5
    const left=Math.max(0,Math.floor(x-reach-bounds[0])),right=Math.min(size,Math.ceil(x+reach-bounds[0]))
    const bottom=Math.max(0,Math.floor(y-reach-bounds[1])),top=Math.min(size,Math.ceil(y+reach-bounds[1]))
    for(let py=bottom;py<top;py++)for(let px=left;px<right;px++){
      const dx=bounds[0]+px+.5-x,dy=bounds[1]+py+.5-y
      let d2=dx*dx+dy*dy,facing=1
      if(source.normal){
        const out=dx*source.normal[0]+dy*source.normal[1];if(out<=0)continue
        const across=Math.max(0,Math.abs(-dx*source.normal[1]+dy*source.normal[0])-source.width*.5)
        d2=out*out+across*across+(source.height??2)**2*.25
        const t=Math.min(1,out/.45);facing=t*t*(3-2*t)
      }
      const f=Math.max(0,1-d2/(radius*radius))**2*facing
      if(f===0)continue
      const i=(py*size+px)*3;for(let c=0;c<3;c++)work[i+c]+=colour[c]*f
    }
  }
  for(let i=0;i<size*size;i++){for(let c=0;c<3;c++)data[i*4+c]=Math.min(255,Math.round(work[i*3+c]*255));data[i*4+3]=255}
}
