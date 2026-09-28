"""Run with Blender's Python: native simplification must retain holes and steps."""
import math
import copy
import unittest
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from mathutils.bvhtree import BVHTree
from izma_collision_mesh import simplify_collision_surface,simplify_packed_collision,finalize_packed_collision


def unroll(x,y,z):
    return [3200*math.atan2(z,x),y,3200-math.hypot(x,z)]


def physical(points):
    return [((3200-h)*math.cos(x/3200),y,(3200-h)*math.sin(x/3200)) for x,y,h in points]


class CollisionMeshTests(unittest.TestCase):
    def test_final_compounds_do_not_accumulate_repeated_approximation(self):
        points=[]
        for z in range(40):
            a,b,c,d=[unroll(3190,y,t) for t,y in [(z,0),(z+1,0),(z+1,4),(z,4)]]
            points.extend([a,b,c,a,c,d])
        source={'vertices':[v for p in points for v in p],'meshes':{'walk':list(range(len(points)))},
                'surfaces':[{'indices':list(range(len(points))),'bounds':[0,0,41,4]}],
                'collisionPartition':{'version':2}}
        first,audit=finalize_packed_collision(source)
        self.assertGreater(audit['removedTriangles'],0)
        self.assertEqual(first['collisionPartition'],source['collisionPartition'])
        self.assertEqual(first['meshes'],source['meshes'])
        second,repeated=finalize_packed_collision(first)
        self.assertIs(second,first);self.assertTrue(repeated['reused'])
        changed=copy.deepcopy(first)
        changed['vertices'][changed['surfaces'][0]['indices'][0]*3+2]+=.1
        with self.assertRaisesRegex(ValueError,'native source'):finalize_packed_collision(changed)

    def test_a_dense_curved_coordinate_floor_keeps_its_entrance_void(self):
        points=[]
        for z in range(40):
            for y in range(8):
                if 16<=z<24 and 2<=y<6:continue
                a,b,c,d=[unroll(3190,yy,zz) for zz,yy in [(z,y),(z+1,y),(z+1,y+1),(z,y+1)]]
                points.extend([a,b,c,a,c,d])
        packed={'vertices':[v for p in points for v in p],
                'meshes':{'walk':list(range(len(points)))},
                'surfaces':[{'indices':list(range(len(points))),'bounds':[0,0,41,8],'groundSurface':False}]}
        before=copy.deepcopy(packed)
        result,audit=simplify_packed_collision(packed)
        reduced=[result['vertices'][i*3:i*3+3] for i in result['surfaces'][0]['indices']]
        error=audit['maximumSampledError']
        self.assertEqual(packed,before)
        self.assertEqual(result['meshes'],packed['meshes'])
        self.assertEqual(result['vertices'][:len(packed['vertices'])],packed['vertices'])
        self.assertFalse(result['surfaces'][0]['groundSurface'])
        self.assertEqual(audit['accepted'],1)
        self.assertLess(len(reduced),len(points)//2)
        self.assertLessEqual(error,.005)
        tree=BVHTree.FromPolygons(physical(reduced),[(i,i+1,i+2) for i in range(0,len(reduced),3)],all_triangles=True)
        for z in [.5,15.5,24.5,39.5]:
            hit=tree.ray_cast((3180,4,z),(1,0,0),20)[0]
            self.assertIsNotNone(hit)
            self.assertAlmostEqual(hit.x,3190,places=3)
        self.assertIsNone(tree.ray_cast((3180,4,20),(1,0,0),20)[0])

    def test_a_step_and_its_vertical_wall_remain_solid(self):
        points=[]
        for z in range(20):
            x=3190 if z<10 else 3189
            a,b,c,d=[unroll(x,y,t) for t,y in [(z,0),(z+1,0),(z+1,4),(z,4)]]
            points.extend([a,b,c,a,c,d])
        a,b,c,d=[unroll(x,y,10) for x,y in [(3189,0),(3190,0),(3190,4),(3189,4)]]
        points.extend([a,b,c,a,c,d])
        reduced,error=simplify_collision_surface(points)
        self.assertLessEqual(error,.005)
        tree=BVHTree.FromPolygons(physical(reduced),[(i,i+1,i+2) for i in range(0,len(reduced),3)],all_triangles=True)
        for z,x in [(5,3190),(15,3189)]:
            self.assertAlmostEqual(tree.ray_cast((3180,2,z),(1,0,0),20)[0].x,x,places=3)
        self.assertAlmostEqual(tree.ray_cast((3189.5,2,9),(0,0,1),2)[0].z,10,places=3)


if __name__=='__main__':unittest.main(argv=['blender-collision-mesh'])
