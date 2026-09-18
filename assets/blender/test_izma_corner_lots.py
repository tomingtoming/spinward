import math
import unittest
from izma_corner_lots import corner_outline,trim_corner,frontage_edges,simplify
from izma_ground_patches import area
from plan_izma_urban import overlaps


class CornerLots(unittest.TestCase):
    def test_oblique_plot_follows_both_streets_and_keeps_walking_verges(self):
        for angle in [45,75,90,120,150]:
            second=(math.cos(math.radians(angle)),math.sin(math.radians(angle)))
            polygon,fronts=corner_outline((1,0),second,4.5,6.5)
            self.assertGreater(area(polygon),35)
            self.assertTrue(all(length>=3.5 for length,_ in frontage_edges(polygon,fronts)))
            for normal,lower in fronts:
                self.assertTrue(all(sum(a*b for a,b in zip(p,normal))>=lower-1e-6 for p in polygon))

    def test_reserved_door_cannot_be_swallowed_or_turn_into_a_sliver(self):
        polygon,fronts=corner_outline((1,0),(0,1),4.5,4.5)
        door=[(13,13),(27,13),(27,27),(13,27)]
        result=trim_corner(polygon,[door],fronts)
        # A corner may be omitted when the convex remainder cannot retain
        # both street fronts; it must never fill an occupied entrance.
        if result:
            self.assertFalse(overlaps(result,door,-.001))
            self.assertGreaterEqual(area(result),35)
            self.assertTrue(all(length>=3.5 for length,_ in frontage_edges(result,fronts)))
        self.assertEqual(trim_corner(polygon,[polygon],fronts),[])

    def test_straight_and_reflex_sectors_are_not_corner_parcels(self):
        for second in [(-1,0),(0,-1),(1,0)]:
            self.assertEqual(corner_outline((1,0),second,5,5)[0],[])
        self.assertEqual(simplify([[0,0,2],[1,0,3],[2,0,4],[2,2,4]]),[[0,0],[2,0],[2,2]])


if __name__=='__main__':unittest.main()
