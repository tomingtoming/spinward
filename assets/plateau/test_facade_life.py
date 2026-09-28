import unittest
import numpy as np
from shapely.geometry import box,Polygon
from shapely.strtree import STRtree
from prepare_facade_life import projection,entry_access,entrance_position

class FlatGrid:
    origin=[-20,-20];step=1;z=np.zeros((81,81))
    def height(self,x,y):return np.zeros_like(x)

class FacadeLifeTest(unittest.TestCase):
    def test_projection_is_outside_wall_and_detects_own_courtyard(self):
        w=dict(a=[0,0],b=[10,0],normal=[0,-1],length=10)
        p=projection(w,1.12)
        self.assertFalse(p.intersects(box(0,0,10,10)))
        self.assertTrue(p.intersects(box(0,-1.5,10,-1)))
        self.assertAlmostEqual(p.area,(10-.64)*(1.12-.07))

    def test_entry_corridor_rejects_obstacles_water_and_slope(self):
        w=dict(a=[0,0],b=[10,0],normal=[0,-1],length=10)
        row=dict(id='test-house',usage='住宅')
        own=box(0,0,10,10);road=box(-10,-5,20,-3);water=Polygon()
        shapes=[own];nearby=[dict(id='test-house')]
        entry_access(row,w,road,water,nearby,shapes,STRtree(shapes),FlatGrid())
        self.assertIn('entryAccess',w)
        self.assertAlmostEqual(w['entryAccess']['start'][0],entrance_position(row,w)[0])
        self.assertAlmostEqual(w['entryAccess']['end'][1],-3)
        obstacle=box(-10,-2.5,20,-1.5);shapes=[own,obstacle];nearby.append(dict(id='neighbour'))
        entry_access(row,w,road,water,nearby,shapes,STRtree(shapes),FlatGrid())
        self.assertNotIn('entryAccess',w)
        entry_access(row,w,road,obstacle,nearby[:1],[own],STRtree([own]),FlatGrid())
        self.assertNotIn('entryAccess',w)
        class Slope(FlatGrid):
            def height(self,x,y):return y*.1
        entry_access(row,w,road,water,nearby[:1],[own],STRtree([own]),Slope())
        self.assertNotIn('entryAccess',w)

if __name__=='__main__':unittest.main()
