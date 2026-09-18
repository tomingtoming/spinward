"""Run inside Blender with the saved izma-blocks.blend, not the open GUI."""
import bpy,json,unittest
from pathlib import Path
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parents[2]
PLAN=json.loads((ROOT/'assets/blender/izma-block-parcels.json').read_text())
SCENE=bpy.data.scenes['SW_izma_blocks'];SCENE.view_layers[0].update()


def tree(objects):
    vertices=[];faces=[]
    for obj in objects:
        mesh=obj.data;mesh.calc_loop_triangles();offset=len(vertices)
        vertices.extend(obj.matrix_world@v.co for v in mesh.vertices)
        faces.extend(tuple(offset+i for i in t.vertices) for t in mesh.loop_triangles)
    return BVHTree.FromPolygons(vertices,faces,all_triangles=True)


class SavedBlocks(unittest.TestCase):
    def test_roofs_keep_the_same_height_at_all_three_lods(self):
        for block in PLAN['blocks']:
            for plot in block['plots']:
                x,y=[sum(p[k] for p in plot['outline'])/len(plot['outline']) for k in range(2)]
                expected=plot['floor']+plot['height']+.2+(1.1 if plot['family']=='house' else 0)
                for lod in range(3):
                    obj=next(o for o in SCENE.objects if o.name==plot['id']+f'_lod{lod}')
                    hit=tree([obj]).ray_cast((y,-x,expected+20),(0,0,-1))[0]
                    self.assertIsNotNone(hit,(plot['id'],lod))
                    self.assertAlmostEqual(hit.z,expected,delta=.005)

    def test_saved_courts_support_the_two_unobstructed_gate_routes(self):
        for block in PLAN['blocks']:
            meshes=[o for o in SCENE.objects if o.type=='MESH' and o.get('block_id')==block['id'] and o.get('lod') in [0,-1]]
            bvh=tree(meshes);upper=max(p['floor'] for p in block['plots'])+.8
            for g in block['gates']:
                for a,b in [(g['start'],g['end']),(g['end'],block['centre'])]:
                    for i in range(1,20):
                        t=i/20;x,y=[a[k]+(b[k]-a[k])*t for k in range(2)]
                        hit=bvh.ray_cast((y,-x,upper+40),(0,0,-1))[0]
                        self.assertIsNotNone(hit,(block['id'],g['edge'],i))
                        self.assertLess(hit.z,upper,(block['id'],g['edge'],i))


if __name__=='__main__':
    result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(SavedBlocks))
    if not result.wasSuccessful():raise SystemExit(1)
