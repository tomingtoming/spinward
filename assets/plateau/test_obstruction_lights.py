import unittest
import numpy as np
from shapely.geometry import Point, Polygon
from prepare_obstruction_lights import roof_anchors

class RoofSupport(unittest.TestCase):
    def test_only_highest_actual_roof_not_podium_or_building_box_center(self):
        p=np.array([[0,0,20],[80,0,20],[80,80,20],[0,80,20],[30,30,80],[45,30,80],[45,45,80],[30,45,80]],dtype=float)
        anchors=roof_anchors(p,np.array([0,1,2,0,2,3,4,5,6,4,6,7]))
        self.assertEqual(len(anchors),4)
        for a in anchors:
            self.assertEqual(a['point'][2],80)
            self.assertTrue(Polygon([[30,30],[45,30],[45,45],[30,45]]).covers(Point(*a['point'][:2])))

    def test_slightly_sloped_source_height_is_interpolated_on_support(self):
        p=np.array([[0,0,80],[20,0,80.02],[20,20,80.04],[0,20,80.02]],dtype=float)
        for a in roof_anchors(p,np.array([0,1,2,0,2,3])):
            x,y,z=a['point'];self.assertAlmostEqual(z,80+(x+y)*.001)

    def test_missing_roof_is_not_replaced_with_floating_light(self):
        p=np.array([[0,0,0],[20,0,0],[20,0,80],[0,0,80]],dtype=float)
        self.assertEqual(roof_anchors(p,np.array([0,1,2,0,2,3])),[])

if __name__=='__main__':unittest.main()
