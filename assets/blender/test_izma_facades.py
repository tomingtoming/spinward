"""Opening visibility and use checks, independent of Blender scene placement."""
import unittest
from collections import Counter
from izma_facades import facade, window_rows
from izma_mesh_builder import BuildingMeshBuilder


class Mesh:
    def __init__(self): self.faces = []
    def face(self, points, material, floor=False): self.faces.append((points, material))
    def quad(self, a, b, c, d, material, floor=False): self.face([a, b, c, d], material)
    def box(self, *args, **kwargs): pass  # balcony geometry does not take part in this aperture probe

    def front_hit(self, x, z):
        # An orthogonal ray into the front wall. The sample lies inside an
        # opening, away from its vertical reveals and window divider.
        hits = []
        for points, material in self.faces:
            if max(p[1] for p in points) - min(p[1] for p in points) > 1e-8: continue
            if min(p[0] for p in points) < x < max(p[0] for p in points) and min(p[2] for p in points) < z < max(p[2] for p in points):
                hits.append((points[0][1], material))
        return min(hits)


class FacadesTest(unittest.TestCase):
    def test_balcony_support_remains_without_a_second_face_on_the_wall(self):
        for lod in [0, 1]:
            mesh = BuildingMeshBuilder(None, None)
            facade(mesh, 0, 0, 0, 38, 14, 4, 'apartment', 118, lod, 'wall-grey', True)
            levels = set()
            for face, material, ground in zip(mesh.f, mesh.m, mesh.g):
                points = [mesh.v[i] for i in face]
                if material != 'foundation': continue
                low, high = min(p[2] for p in points), max(p[2] for p in points)
                if ground and abs(high-low) < 1e-8: levels.add(round(high, 3))
                self.assertFalse(all(abs(p[1]+7) < 1e-8 for p in points) and .15 < high-low < .17,
                                 'A hidden slab back coincides with the opaque wall')
            self.assertEqual(levels, {3.2, 6.4, 9.6})

    def test_reveals_and_wall_bands_share_every_edge_vertex_before_cylinder_projection(self):
        mesh=Mesh()
        facade(mesh,0,0,0,38,14,6,'shop-house',118,0,'wall-grey')
        walls=Counter();reveals=Counter()
        for points,material in mesh.faces:
            if material not in ['wall-grey','foundation']:continue
            for a,b in zip(points,points[1:]+points[:1]):
                if a[1]==b[1]==-7 and a[2]==b[2] and a[0]!=b[0]:
                    (walls if material=='wall-grey' else reveals)[tuple(sorted([a,b]))]+=1
        self.assertGreater(len(reveals),20)
        for edge in reveals:self.assertEqual(walls[edge],1,edge)

    def test_openings_are_visible_through_the_outer_wall(self):
        for kind in ['house', 'shop-house', 'apartment', 'office', 'workshop']:
            for n in [33, 118, 261]:
                near, middle = Mesh(), Mesh()
                for lod, mesh in enumerate([near, middle]):
                    facade(mesh, 0, 0, 0, 18, 14, 4, kind, n, lod, 'wall-grey', kind == 'apartment')
                rows = window_rows(18, 4, kind, n, 0, kind == 'apartment')
                for opening in [o for row in rows for o in row]:
                    x = opening['left'] * .7 + opening['right'] * .3
                    z = (opening['bottom'] + opening['top']) / 2
                    y, material = near.front_hit(x, z)
                    self.assertEqual(material, opening['pane'])
                    self.assertGreater(y, -7 + .1)
                    self.assertLess(y, -7 + .25)
                    self.assertEqual(middle.front_hit(x, z)[1], opening['pane'])
                # The opaque sill/spandrel must remain between storeys.
                self.assertEqual(near.front_hit(-8.7, 3.15), (-7, 'wall-grey'))

    def test_residential_sills_balcony_doors_and_office_colour(self):
        residential, office = set(), set()
        for n in range(50):
            for kind in ['house', 'apartment', 'shop-house', 'office']:
                for side in range(4):
                    for row, openings in enumerate(window_rows(20, 5, kind, n, side, kind == 'apartment', True)):
                        for o in openings:
                            if o['pane'] != 'glass': (office if kind == 'office' else residential).add(o['pane'])
                            if row and kind != 'office':
                                self.assertEqual(o['balcony'], kind == 'apartment' and side == 0)
                                if o['balcony']:
                                    self.assertAlmostEqual(o['bottom'] - row * 3.2, .24)
                                else:
                                    self.assertGreaterEqual(o['bottom'] - row * 3.2, .999)
                                    self.assertLessEqual(o['top'] - o['bottom'], 1.401)
                            if side != 0: self.assertFalse(o['shop'])
        self.assertEqual(office, {'window-cool'})
        self.assertEqual(residential, {'window-warm', 'window-neutral', 'window-cool'})

    def test_openings_remain_within_the_building_edges(self):
        for n in range(20):
            for side in range(4):
                for row in window_rows(9, 3, 'house', n, side):
                    for opening in row:
                        self.assertGreater(opening['left'], -4.5)
                        self.assertLess(opening['right'], 4.5)
                        self.assertGreater(opening['right'] - opening['left'], .13)


if __name__ == '__main__': unittest.main()
