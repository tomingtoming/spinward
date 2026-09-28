"""Small civilian shop names as saved native mesh faces, with no font asset.

Use Blender's built-in typeface. Cache the evaluated glyph outlines once per
label; emitted triangles become part of the building's near LOD mesh.
"""


class NativeSigns:
    def __init__(self, scene):
        self.scene=scene; self.cache={}

    def __call__(self,builder,label,x,y,z,width,height):
        import bpy
        if label not in self.cache:
            curve=bpy.data.curves.new('SW_identity_sign_'+label,'FONT')
            curve.body=label;curve.size=1;curve.resolution_u=1;curve.fill_mode='BOTH'
            obj=bpy.data.objects.new(curve.name,curve);self.scene.collection.objects.link(obj)
            self.scene.view_layers[0].update()
            evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
            mesh=bpy.data.meshes.new_from_object(evaluated)
            mesh.calc_loop_triangles()
            points=[tuple(v.co) for v in mesh.vertices]
            faces=[tuple(t.vertices) for t in mesh.loop_triangles]
            assert points and faces, ('Empty shop sign',label)
            self.cache[label]=(points,faces)
            bpy.data.meshes.remove(mesh)
            bpy.data.objects.remove(obj,do_unlink=True)
            bpy.data.curves.remove(curve)
        points,faces=self.cache[label]
        lo=min(p[0] for p in points);hi=max(p[0] for p in points)
        bottom=min(p[1] for p in points);top=max(p[1] for p in points)
        scale=min(width/(hi-lo),height/(top-bottom))
        for face in faces:
            builder.face([(x+(points[i][0]-(lo+hi)/2)*scale,y,z+(points[i][1]-bottom)*scale)
                          for i in face], 'wall-ivory')
