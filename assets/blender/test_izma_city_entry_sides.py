"""Native lateral rays must meet stairs below their unchanged walking tops."""
import math
from pathlib import Path
import sys
import unittest
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).resolve().parent))
from izma_city_entry_sides import entry_side_faces


class EntranceSidesTest(unittest.TestCase):
    def test_ascending_descending_and_ramp_sides_close_to_actual_ground(self):
        for a,b,ramp in [(.2,1.1,False),(1.1,.2,False),(.2,.5,True)]:
            parcel={'entrance':{'start':[10,20,a],'end':[13,20,b],
                                'width':1.6,'steps':3,'ramp':ramp}}
            ground=lambda p:.03*(p[0]-10)+.02*(p[1]-20)
            faces=entry_side_faces(parcel,ground)
            self.assertLessEqual(max(p[2] for p in faces[-1]), a if ramp else min(a,a+(b-a)/3))
            points=[p for f in faces for p in f]
            tree=BVHTree.FromPolygons(points,[tuple(range(i,i+4)) for i in range(0,len(points),4)])
            for i in range(3):
                x=10+i+.5
                top=a+(b-a)*((i+.5)/3 if ramp else (i+1)/3)
                h=(top+max(ground([x,19.2]),ground([x,20.8])))/2
                for y,d in [(18,1),(22,-1)]:
                    hit=tree.ray_cast((x,y,h),(0,d,0),4)[0]
                    self.assertIsNotNone(hit)
                    self.assertAlmostEqual(hit.y,20-d*.8,places=5)
                # Cheeks do not insert a horizontal floor above/below a tread.
                self.assertIsNone(tree.ray_cast((x,20,3),(0,0,-1),4)[0])
            for f in faces:
                for p in f:
                    self.assertTrue(abs(p[1]-19.2)<1e-8 or abs(p[1]-20.8)<1e-8)
                    self.assertTrue(10<=p[0]<=13)


if __name__=='__main__':unittest.main(argv=['native-entry-sides'])
