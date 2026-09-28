import unittest
from prepare_metro_roads import accessible, shortest


class RoadSourceTest(unittest.TestCase):
    def test_unsupported_levels_and_access_do_not_become_ground_routes(self):
        for extra in [{'foot': 'no'}, {'tunnel': 'yes'}, {'level': '1'}, {'access': 'private'},
                      {'layer': '2', 'bridge': 'yes'}, {'opening_hours': '09:00-17:00'}]:
            self.assertFalse(accessible(dict(highway='footway', **extra)))
        self.assertFalse(accessible(dict(highway='motorway')))
        self.assertFalse(accessible(dict(highway='steps')))
        self.assertTrue(accessible(dict(highway='footway', layer='1', bridge='yes')))

    def test_disconnected_graph_never_invents_a_crossing(self):
        graph = {1: [(2, 10, 0)], 2: [(1, 10, 0)], 3: [(4, 10, 1)], 4: [(3, 10, 1)]}
        with self.assertRaisesRegex(ValueError, 'No public source connection'):
            shortest(graph, 1, 4)
        self.assertEqual(shortest(graph, 1, 2), [(1, 2, 0)])


if __name__ == '__main__': unittest.main()
