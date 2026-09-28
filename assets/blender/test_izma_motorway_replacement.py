"""A vertical retaining wall must not vanish when its road is cut in XY."""
import math
import unittest
from izma_motorway_replacement import FootprintCuts, face_area, split_footprint, split_planes, prism_planes


class RetirementCutsTest(unittest.TestCase):
    cutter = [(0,0),(2,0),(2,2),(0,2)]

    def test_vertical_wall_retains_both_sides(self):
        wall = [(-1,1,0),(3,1,0),(3,1,5),(-1,1,5)]
        outside, inside = split_footprint(wall, self.cutter)
        self.assertAlmostEqual(sum(map(face_area,outside)),10)
        self.assertAlmostEqual(face_area(inside),10)
        self.assertEqual(len(outside),2)

    def test_boundary_wall_owned_once(self):
        wall = [(0,0,0),(0,2,0),(0,2,5),(0,0,5)]
        outside, inside = split_footprint(wall, self.cutter)
        self.assertEqual(outside,[])
        self.assertAlmostEqual(face_area(inside),10)

    def test_rotated_sloped_surface_conserves_area(self):
        points = [(-2,1,3),(3,-1,5),(3,4,7)]
        for angle in [0,.19,1.2,math.pi]:
            def turn(p):
                return (p[0]*math.cos(angle)-p[1]*math.sin(angle),p[0]*math.sin(angle)+p[1]*math.cos(angle),*p[2:])
            rotated = [turn(p) for p in points]
            outside, inside = split_footprint(rotated,[turn(p) for p in self.cutter])
            self.assertAlmostEqual(face_area(rotated),sum(map(face_area,outside))+face_area(inside))

    def test_overlapping_cuts_do_not_double_remove(self):
        cuts = FootprintCuts([('a',self.cutter),('b',[(1,0),(3,0),(3,2),(1,2)])])
        wall = [(-1,1,0),(4,1,0),(4,1,5),(-1,1,5)]
        outside, inside = cuts.split(wall)
        self.assertAlmostEqual(sum(map(face_area,outside)),10)
        self.assertAlmostEqual(sum(face_area(p) for _,p in inside),15)

    def test_distant_triangle_is_unchanged(self):
        cuts = FootprintCuts([('a',self.cutter)])
        triangle = [(100,100,0),(101,100,0),(100,101,0)]
        self.assertEqual(cuts.split(triangle),([triangle],[]))

    def test_merge_cuts_guard_at_road_level_only(self):
        planes=prism_planes(self.cutter)+[((0,0,1),-5),((0,0,-1),7)]
        wall=[(-1,1,0),(3,1,0),(3,1,10),(-1,1,10)]
        outside,inside=split_planes(wall,planes)
        self.assertAlmostEqual(sum(map(face_area,outside)),36)
        self.assertAlmostEqual(face_area(inside),4)

    def test_upper_road_survives_lower_merge_opening(self):
        planes=prism_planes(self.cutter)+[((0,0,1),-5),((0,0,-1),7)]
        wall=[(-1,1,12),(3,1,12),(3,1,13),(-1,1,13)]
        outside,inside=split_planes(wall,planes)
        self.assertEqual(inside,[])
        self.assertAlmostEqual(sum(map(face_area,outside)),4)


if __name__ == '__main__':
    unittest.main()
