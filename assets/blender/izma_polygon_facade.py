"""Recessed civilian openings on authored polygonal building fronts."""
import math
from izma_facades import window_rows


def wall(builder,a,b,plot,edge,lod,material):
    length=math.dist(a,b);tx,ty=(b[0]-a[0])/length,(b[1]-a[1])/length;nx,ny=ty,-tx
    def at(u,z,out=0):return (a[0]+tx*(u+length/2)+nx*out,a[1]+ty*(u+length/2)+ny*out,z)
    rows=window_rows(length,plot['floors'],plot['family'],plot['seed'],0 if edge in plot['frontEdges'] else 1,
                     balcony=edge in plot.get('balconyEdges',[]))
    cuts=sorted({opening[k] for row in rows for opening in row for k in ['left','right']})
    def rect(left,right,low,high,mat,out=0):
        if right-left<1e-7 or high-low<1e-7:return
        points=[left,*[v for v in cuts if left<v<right],right] if lod==0 else [left,right]
        for p,q in zip(points,points[1:]):builder.quad(at(p,low,out),at(q,low,out),at(q,high,out),at(p,high,out),mat)
    if edge in plot.get('blankEdges',[]):
        rect(-length/2,length/2,0,plot['height'],material)
        return
    if lod:
        rect(-length/2,length/2,0,plot['height'],material)
    if lod==2:return
    for i,openings in enumerate(rows):
        if lod==0:
            if not openings:rect(-length/2,length/2,i*3.2,(i+1)*3.2,material)
            else:
                low,high=openings[0]['bottom'],openings[0]['top']
                rect(-length/2,length/2,i*3.2,low,material);rect(-length/2,length/2,high,(i+1)*3.2,material)
                left=-length/2
                for opening in openings:
                    rect(left,opening['left'],low,high,material);left=opening['right']
                rect(left,length/2,low,high,material)
        for opening in openings:
            left,right,low,high=[opening[k] for k in ['left','right','bottom','top']]
            if lod==0:
                corners=[(left,low),(right,low),(right,high),(left,high)]
                for p,q in zip(corners,corners[1:]+corners[:1]):
                    builder.face([at(*p),at(*q),at(*q,-.16),at(*p,-.16)],'foundation')
            rect(left,right,low,high,'metal',.012 if lod else -.16)
            rect(left+.065,right-.065,low+.065,high-.065,opening['pane'],.022 if lod else -.148)
    door=plot['entrance']['end']
    middle=((a[0]+b[0])/2,(a[1]+b[1])/2)
    if math.dist(middle,door[:2])<.01:
        rect(-.68,.68,.04,2.48,'metal',.02)
        rect(-.58,.58,.12,2.38,'glass',.035)
