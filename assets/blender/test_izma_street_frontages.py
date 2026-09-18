import math
import unittest
from izma_ground_patches import area, clip
from izma_street_frontages import PavementPlan, clean, covers, ribbons, subtract, triangle_altitude


class PavementTests(unittest.TestCase):
    def test_collinear_and_collapsed_export_faces_have_no_physical_floor(self):
        self.assertEqual(triangle_altitude([(-730,-9344,9.3),(-729,-9344,9.3),(-728,-9344,9.3)]),0)
        self.assertEqual(triangle_altitude([(1,2,3)]*3),0)
        # A real narrow surface or vertical parapet remains physical.
        self.assertGreater(triangle_altitude([(0,0,0),(2,0,0),(2,.002,0)]),1e-6)
        self.assertGreater(triangle_altitude([(0,0,0),(2,0,0),(2,0,1.05)]),1e-6)

    def test_clipping_keeps_the_union_without_overlap_or_holes(self):
        square = [(0,0),(8,0),(8,8),(0,8)]
        hole = [(2,2),(6,2),(6,6),(2,6)]
        pieces = subtract(square,hole)
        self.assertAlmostEqual(sum(area(p) for p in pieces),48)
        for i,p in enumerate(pieces):
            self.assertFalse(clip(p,hole))
            for q in pieces[:i]:self.assertFalse(clip(p,q))

    def test_bent_road_has_connected_corner_paving_without_covering_the_road(self):
        profile = [(0,0,0),(10,0,0),(15,8,0)]
        roads = [(a,b,4) for a,b in zip(profile,profile[1:])]
        plan = PavementPlan(roads,[])
        pieces = [p for shape in ribbons(profile,4,1.8) for p in plan.add(shape)]
        # The outside of the bend lies between the two parallel strips.
        point=(11,-2.5)
        def contains(poly,point):
            return all((b[0]-a[0])*(point[1]-a[1])-(b[1]-a[1])*(point[0]-a[0])>=-1e-8 for a,b in zip(poly,poly[1:]+poly[:1]))
        self.assertTrue(any(contains(p,point) for p in pieces))
        for i,p in enumerate(pieces):
            for q,_ in plan.blocked.shapes:self.assertFalse(clip(p,q))
            for q in pieces[:i]:self.assertFalse(clip(p,q))

    def test_graded_entrance_remains_a_hole_in_the_new_pavement(self):
        entrance=[(4,1.9),(6,1.9),(6,5),(4,5)]
        plan=PavementPlan([((0,0),(10,0),4)],[entrance])
        pieces=[p for shape in ribbons([(0,0,0),(10,0,0)],4,1.8) for p in plan.add(shape)]
        self.assertTrue(pieces)
        self.assertTrue(all(not clip(p,entrance) for p in pieces))

    def test_unequal_edge_subdivisions_do_not_turn_an_internal_join_into_a_guard(self):
        plan=PavementPlan([],[])
        for polygon in [[(0,0),(8,0),(8,2),(0,2)],[(0,2),(3,2),(3,4),(0,4)],[(3,2),(8,2),(8,4),(3,4)]]:
            plan.add(polygon)
        for x in [1,3,6]:
            self.assertTrue(covers(plan.accepted,(x,2.012)))
            self.assertFalse(covers(plan.accepted,(x,4.012)))

    def test_actual_carriageway_edge_clips_the_sweep_without_a_nominal_width_gap(self):
        plan=PavementPlan([((0,0),(10,0),3.7)],[])
        for shape in ribbons([(0,0,0),(10,0,0)],4,1.8):plan.add(shape)
        self.assertTrue(covers(plan.accepted,(5,1.9)))
        self.assertFalse(covers(plan.accepted,(5,1.8)))


if __name__=='__main__':unittest.main()
