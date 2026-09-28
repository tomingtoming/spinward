import unittest
from shapely.geometry import box, GeometryCollection, Point
from prepare_metro_night import plan_lamps


class Grid:
    def height(self,x,y): return 4+x*.012+y*.007


class NightPlanTest(unittest.TestCase):
    def test_fixture_is_on_road_and_ground_and_avoids_building(self):
        road=box(0,0,200,14);building=box(45,12.5,95,24)
        lamps,_=plan_lamps(road,GeometryCollection(),[building],Grid(),[-5,-5,205,25])
        self.assertGreater(len(lamps),3)
        for x,y,z,nx,ny,height,power in lamps:
            self.assertTrue(road.covers(Point(x,y)))
            self.assertGreater(building.distance(Point(x,y)),1.09)
            self.assertAlmostEqual(z,Grid().height(x,y),places=3)
            self.assertTrue(road.covers(Point(x+nx*1.5,y+ny*1.5)))
            self.assertAlmostEqual(nx*nx+ny*ny,1,places=3)
        for i,a in enumerate(lamps):
            for b in lamps[:i]:self.assertGreaterEqual(Point(*a[:2]).distance(Point(*b[:2])),17.99)

    def test_narrow_alley_and_water_do_not_get_floating_lights(self):
        lamps,_=plan_lamps(box(0,0,100,3),GeometryCollection(),[],Grid(),[-1,-1,101,5])
        self.assertEqual(lamps,[])
        road=box(0,0,100,12)
        lamps,_=plan_lamps(road,road,[],Grid(),[-1,-1,101,15])
        self.assertEqual(lamps,[])

    def test_partition_only_owns_existing_boundary_not_a_new_edge(self):
        road=box(0,0,200,14)
        left,_=plan_lamps(road,GeometryCollection(),[],Grid(),[-5,-5,95,25])
        self.assertTrue(left)
        for x,y,*_ in left:self.assertTrue(y<1 or y>13)


if __name__=='__main__':unittest.main()
