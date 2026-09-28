import unittest
from shapely import LineString, box, Point, Polygon
from shapely.ops import unary_union
from izma_street_blocks import street_blocks, outline
from izma_city_parcels import court_path, passage_surface, allocate
from izma_city_doors import doorway


def road(name, points, width=4):
    return {'id': name, 'points': points, 'width': width}


class StreetBlocksTest(unittest.TestCase):
    def test_real_warehouse_and_civic_doors_are_reserved_off_centre_in_both_orientations(self):
        polygon = [[10, 20], [30, 20], [30, 50], [10, 50]]
        for family, expected in [('warehouse', [11.5, 20]), ('civic', [23.6, 20])]:
            door = doorway(polygon, family, 3, 'fixed-door-test')
            self.assertAlmostEqual(door[0], expected[0])
            self.assertAlmostEqual(door[1], expected[1])
            turned = doorway([[-y, x] for x, y in polygon], family, 3, 'fixed-door-test')
            self.assertAlmostEqual(turned[0], -door[1])
            self.assertAlmostEqual(turned[1], door[0])

    def test_crossing_roads_split_faces_and_keep_carriageways_clear(self):
        roads = [road('perimeter', [(0, 0), (100, 0), (100, 100), (0, 100), (0, 0)]),
                 road('cross', [(-10, 45), (110, 65)], 8)]
        blocks = street_blocks(roads, box(-20, -20, 120, 120))
        self.assertEqual(len(blocks), 2)
        for b in blocks:
            self.assertLess(b['site'].intersection(LineString(roads[1]['points']).buffer(4)).area, 1e-6)
        self.assertLess(blocks[0]['site'].intersection(blocks[1]['site']).area, 1e-6)

    def test_open_branch_is_preserved_and_study_boundary_does_not_close_a_street(self):
        outer = road('outer', [(0, 0), (100, 0), (100, 100), (0, 100), (0, 0)])
        branch = road('branch', [(0, 40), (60, 50)], 6)
        blocks = street_blocks([outer, branch], box(-1, -1, 101, 101))
        self.assertEqual(len(blocks), 1)
        self.assertLess(blocks[0]['site'].intersection(LineString(branch['points']).buffer(3, cap_style='flat')).area, 1e-6)
        self.assertEqual(street_blocks([branch], box(-1, -1, 101, 101)), [])

    def test_input_order_and_line_direction_do_not_change_block_identity(self):
        roads = [road('a', [(0, 0), (90, 15), (100, 90)]),
                 road('b', [(100, 90), (-10, 85), (0, 0)])]
        first = street_blocks(roads, box(-20, -20, 120, 120))
        second = street_blocks([{**r, 'points': list(reversed(r['points']))} for r in reversed(roads)],
                               box(-20, -20, 120, 120))
        self.assertEqual([b['id'] for b in first], [b['id'] for b in second])
        self.assertLess(first[0]['site'].symmetric_difference(second[0]['site']).area, 1e-6)

    def test_concave_closed_streets_keep_their_reentrant_shape(self):
        boundary = [(0, 0), (120, 0), (120, 50), (55, 50), (55, 110), (0, 110), (0, 0)]
        blocks = street_blocks([road('bent', boundary)], box(-1, -1, 121, 111))
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0]['site'].intersection(box(60, 60, 100, 100)).area, 0)

    def test_inner_street_is_an_island_and_has_its_own_frontages(self):
        roads = [road('outer', [(0, 0), (160, 0), (160, 160), (0, 160), (0, 0)]),
                 road('inner', [(50, 50), (110, 50), (110, 110), (50, 110), (50, 50)])]
        blocks = street_blocks(roads, box(-1, -1, 161, 161))
        self.assertEqual(len(blocks), 2)
        ring = next(b for b in blocks if b['face'].interiors)
        self.assertFalse(ring['site'].covers(Point(80, 80)))
        self.assertEqual({e['road'] for e in ring['edges']}, {'inner', 'outer'})
        self.assertLess(blocks[0]['site'].intersection(blocks[1]['site']).area, 1e-6)

    def test_passage_goes_around_reserved_building_with_its_full_width(self):
        available = box(0, 0, 100, 100).difference(box(35, 25, 65, 75))
        path = court_path(available, [10, 50], [90, 50])
        self.assertIsNotNone(path)
        self.assertGreater(len(path), 2)
        occupied = LineString(path).buffer(1.6, cap_style='flat', join_style='mitre')
        self.assertLess(occupied.difference(available.buffer(1e-5)).area, 1e-6)

    def test_disconnected_courts_do_not_claim_a_walkable_connection(self):
        available = box(0, 0, 100, 100).difference(box(40, 0, 60, 100))
        self.assertIsNone(court_path(available, [10, 50], [90, 50]))

    def test_pavement_junctions_are_not_overlaid_and_a_ring_keeps_its_hole(self):
        paths = [{'points': [[0, 0], [30, 0], [30, 30], [0, 30], [0, 0]], 'width': 3.2},
                 {'points': [[-10, 0], [10, 0]], 'width': 3.2}]
        pieces = [Polygon(p) for p in passage_surface(paths)]
        pavement = unary_union(pieces)
        self.assertLess(abs(sum(p.area for p in pieces) - pavement.area), 1e-6)
        self.assertFalse(pavement.covers(Point(15, 15)))
        self.assertTrue(pavement.covers(Point(-5, 0)))

    def test_large_block_branches_through_its_interior_without_losing_protected_land(self):
        roads = [road('south', [(0, 0), (320, 0)]), road('east', [(320, 0), (320, 220)]),
                 road('north', [(320, 220), (0, 220)]), road('west', [(0, 220), (0, 0)])]
        block = street_blocks(roads, box(-1, -1, 321, 221))[0]
        available = block['site'].difference(box(135, 75, 185, 145))
        candidate = allocate({'id': 'test-block', 'district': 'a-old-town', 'use': 'mixed', 'band': 0,
                              'available': [outline(available)], 'availableArea': available.area,
                              'boundary': outline(block['face']), 'edges': block['edges']})
        self.assertTrue(candidate['connectedGates'])
        self.assertGreater(len(candidate['gates']), 2)
        pavement = unary_union([Polygon(p) for p in candidate['passagePieces']])
        self.assertLess(pavement.difference(available.buffer(.08)).area, 1e-5)
        plots = [Polygon(p['outline']) for p in candidate['plots']]
        self.assertGreater(len(plots), 20)
        self.assertLess(abs(sum(p.area for p in plots) - unary_union(plots).area), 1e-5)
        for p in plots:
            self.assertTrue(available.covers(p))
            self.assertLess(p.intersection(pavement).area, 1e-6)


if __name__ == '__main__':
    unittest.main()
