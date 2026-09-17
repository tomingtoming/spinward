"""Verify the saved planning meshes, independently of the height recipe."""
import bpy
import math
import json
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parents[2]
plan=json.loads((ROOT/'assets/blender/izma-colony-plan.json').read_text())
flat=bpy.data.scenes['SWC_izma_unrolled']
wrapped=bpy.data.scenes['SWC_izma_cylinder']
flat.view_layers[0].update();wrapped.view_layers[0].update()
radius=plan['radius'];spacing=math.tau*radius/3
sources={o['source_id']:o for o in flat.objects if o.type=='MESH'}
max_error=0;checked=0;terrain_areas=[];river_clearance=[]
for obj in wrapped.objects:
    if obj.type!='MESH':continue
    source=sources.get(obj['source_id'])
    if not source:continue  # C -> A seam is only present in the cylinder view.
    assert len(source.data.vertices)==len(obj.data.vertices),obj.name
    band=obj['band']
    for v,w in zip(source.data.vertices,obj.data.vertices):
        point=source.matrix_world @ v.co
        x,y,h=-point.y-band*spacing,point.x,point.z
        angle=band*math.tau/3+x/radius
        expected=Vector((math.cos(angle)*(radius-h),y,math.sin(angle)*(radius-h)))
        actual=obj.matrix_world @ w.co
        max_error=max(max_error,(actual-expected).length);checked+=1
    assert max_error<.004,('mapping error',obj.name,max_error)

for band in range(3):
    terrain=next(o for o in flat.objects if o.type=='MESH' and o['band']==band and o.get('surface'))
    vertices=[terrain.matrix_world @ v.co for v in terrain.data.vertices]
    terrain.data.calc_loop_triangles()
    triangles=[tuple(t.vertices) for t in terrain.data.loop_triangles]
    area=0
    for tri in triangles:
        a,b,c=[vertices[i] for i in tri]
        area+=abs((b.x-a.x)*(c.y-a.y)-(c.x-a.x)*(b.y-a.y))/2
    expected=plan['radius']*plan['landArcRadians']*plan['span']
    assert abs(area-expected)<30,('missing or overlapping terrain',band,area,expected)
    terrain_areas.append(area)
    tree=BVHTree.FromPolygons(vertices,triangles,all_triangles=True)
    river=next(o for o in flat.objects if o.type=='MESH' and o['band']==band and o.name.startswith('River_'))
    # Check every cross-section's centre, not just a few control points.
    vs=[river.matrix_world @ v.co for v in river.data.vertices]
    values=[]
    for i in range(0,len(vs),2):
        p=(vs[i]+vs[i+1])/2
        hit=tree.ray_cast(Vector((p.x,p.y,1000)),Vector((0,0,-1)))
        assert hit[0] is not None,('river outside terrain',band,tuple(p))
        clearance=p.z-hit[0].z
        assert clearance>.025,('river buried in terrain',band,tuple(p),clearance)
        values.append(clearance)
    drawn=next(o for o in wrapped.objects if o.type=='MESH' and o['band']==band and o.get('surface'))
    drawn.data.calc_loop_triangles()
    curved=BVHTree.FromPolygons([drawn.matrix_world @ v.co for v in drawn.data.vertices],
                               [tuple(t.vertices) for t in drawn.data.loop_triangles],all_triangles=True)
    drawn_river=next(o for o in wrapped.objects if o.type=='MESH' and o['band']==band and o.name.startswith('River_'))
    rvs=[drawn_river.matrix_world @ v.co for v in drawn_river.data.vertices]
    curved_values=[]
    for i in range(0,len(rvs),2):
        p=(rvs[i]+rvs[i+1])/2
        radial=Vector((p.x,0,p.z)).normalized()
        hit=curved.ray_cast(p-radial*100,radial)
        assert hit[0] is not None,('mapped river outside terrain',band,tuple(p))
        clearance=(hit[0]-p).dot(radial)
        assert clearance>.025,('mapped river buried',band,tuple(p),clearance)
        curved_values.append(clearance)
    river_clearance.append({'band':band,'sections':len(values),'minimum':min(values),'maximum':max(values),
                            'cylinderMinimum':min(curved_values),'cylinderMaximum':max(curved_values)})

result={'mappedVertices':checked,'maximumMappingErrorMetres':max_error,
        'terrainAreaSquareMetres':terrain_areas,'riverClearance':river_clearance,
        'scope':'saved mesh mapping, complete base terrain and visible water only; no collision or transport grades'}
(ROOT/'qa/webxr/evidence/colony-plan-20260917/geometry.json').write_text(json.dumps(result,indent=2)+'\n')
