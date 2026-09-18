"""Run in isolated Blender: --python this_file (no scene is saved)."""
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_izma_spatial_data import coarse_mesh, verify_surface


class FarGroundTest(unittest.TestCase):
    def test_straight_strip_reduces_without_moving_source_vertices_or_a_locked_seam(self):
        points = [(x, y, 0) for y in (0, 10, 20, 30) for x in (0, 8)]
        faces = [(i, i + 1, i + 3) for i in (0, 2, 4)] + [(i, i + 3, i + 2) for i in (0, 2, 4)]
        vertices = [v for p in points for v in p]; indices = [i for f in faces for i in f]
        audit = {}
        reduced, triangles = coarse_mesh(vertices, indices, audit)
        self.assertLess(len(triangles), len(faces))
        self.assertTrue(all(tuple(p) in points for p in reduced))
        locked = {points[2], points[3]}
        protected, _ = coarse_mesh(vertices, indices, locked_vertices=locked)
        self.assertTrue(locked.issubset({tuple(p) for p in protected}))
        self.assertLessEqual(audit['maxSampleError'], .1)

    def test_wrong_winding_holes_and_moved_corners_cannot_pass_distance_only(self):
        points = [(0, 0, 0), (8, 0, 0), (8, 8, 0), (0, 8, 0), (4, 4, 0)]
        original = [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)]
        self.assertFalse(verify_surface(points, original, [(0, 2, 1), (0, 3, 2)])['accepted'])
        self.assertFalse(verify_surface(points, original[:3], [(0, 1, 2), (0, 2, 3)])['accepted'])
        bent = [(0, 0, 0), (4, -.3, 0), (8, 0, 0), (8, 8, 0), (0, 8, 0)]
        self.assertFalse(verify_surface(bent, [(0, 1, 4), (1, 3, 4), (1, 2, 3)], [(0, 2, 3), (0, 3, 4)])['accepted'])

    def test_equal_boundary_does_not_hide_a_removed_raised_surface(self):
        points = [(0, 0, 0), (8, 0, 0), (8, 8, 0), (0, 8, 0), (4, 4, 1)]
        original = [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)]
        result = verify_surface(points, original, [(0, 1, 2), (0, 2, 3)])
        self.assertFalse(result['accepted'])

    def test_long_curved_border_keeps_original_coordinates_and_protected_vertices(self):
        points = [(x, y, 0) for x in range(0, 401, 20) for y in (0, 10)]
        faces = [(i, i + 2, i + 3) for i in range(0, 40, 2)] + [(i, i + 3, i + 1) for i in range(0, 40, 2)]
        locked = {points[i] for i in range(18, 24)}
        reduced, triangles = coarse_mesh([v for p in points for v in p], [i for f in faces for i in f], locked_vertices=locked)
        self.assertTrue(locked.issubset({tuple(p) for p in reduced}))
        self.assertTrue(all(tuple(p) in points for p in reduced))
        def curve(p):
            x, y, z = p
            return ((3200 - z) * math.cos(x / 3200) - 3200, y, (3200 - z) * math.sin(x / 3200))
        mapping = {tuple(p): i for i, p in enumerate(points)}
        candidate = [tuple(mapping[tuple(reduced[i])] for i in f) for f in triangles]
        self.assertTrue(verify_surface([curve(p) for p in points], faces, candidate)['accepted'])


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(FarGroundTest)
    if not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful():
        raise RuntimeError('Far ground contract failed')
