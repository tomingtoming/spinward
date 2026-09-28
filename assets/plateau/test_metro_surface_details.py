import unittest

import numpy as np
from shapely import STRtree
from shapely.geometry import Polygon, box

from metro_surface_details import SurfaceDraper
from prepare_metro_surface_finish import tile_surfaces


class TestGrid:
    def height(self, x, y):
        x, y = np.broadcast_arrays(np.asarray(x), np.asarray(y))
        # A crease across the DEM diagonal catches large undraped triangles.
        return 3 + np.maximum(x, y)*.15 + x*.02

    def normals(self, x, y):
        return np.tile([0, 0, 1.], (np.size(x), 1))


class SurfaceDetailsTest(unittest.TestCase):
    def test_holes_and_outside_crop_keep_their_area(self):
        shape = Polygon([(-2, 1), (9, 1), (9, 9), (-2, 9)],
                        holes=[[(2, 3), (6, 3), (6, 7), (2, 7)]])
        mesh = SurfaceDraper(TestGrid(), [0, 0, 10, 10]).paint(shape, '#eeeeee')
        faces = mesh['position'][mesh['index'].reshape(-1, 3)]
        a, b = faces[:, 1, :2]-faces[:, 0, :2], faces[:, 2, :2]-faces[:, 0, :2]
        area = np.abs(a[:, 0]*b[:, 1]-a[:, 1]*b[:, 0]).sum()/2
        self.assertAlmostEqual(area, shape.intersection(box(0, 0, 10, 10)).area, places=4)
        for face in faces:
            self.assertTrue(shape.buffer(1e-5).covers(Polygon(face[:, :2])))

    def test_each_face_follows_the_existing_creased_surface(self):
        grid = TestGrid()
        mesh = SurfaceDraper(grid, [0, 0, 10, 10]).paint(box(1.17, .83, 8.73, 9.14), '#999999')
        faces = mesh['position'][mesh['index'].reshape(-1, 3)]
        centres = faces.mean(axis=1)
        np.testing.assert_allclose(centres[:, 2], grid.height(centres[:, 0], centres[:, 1])+.016, atol=2e-6)

    def test_clipped_and_whole_faces_point_upward(self):
        mesh = SurfaceDraper(TestGrid(), [0, 0, 10, 10]).paint(box(0, 0, 8.73, 9.14), '#999999')
        p = mesh['position'][mesh['index'].reshape(-1, 3)]
        a, b = p[:, 1, :2]-p[:, 0, :2], p[:, 2, :2]-p[:, 0, :2]
        self.assertTrue(np.all(a[:, 0]*b[:, 1]-a[:, 1]*b[:, 0] > 0))

    def test_road_wins_over_water_without_coplanar_overlap(self):
        rows = [(0, 1, box(0, 0, 10, 10), '住宅用地'),
                (1, 2, box(0, 4, 10, 6), '水面'),
                (2, 3, box(4, 0, 6, 10), '道路用地')]
        result = dict(tile_surfaces(rows, STRtree([r[2] for r in rows]), {'bounds':[0, 0, 10, 10]}))
        self.assertEqual(result['道路用地'].area, 20)
        self.assertEqual(result['水面'].area, 16)
        self.assertEqual(sum(s.area for s in result.values()), 100)
        self.assertEqual(result['道路用地'].intersection(result['水面']).area, 0)


if __name__ == '__main__':
    unittest.main()
