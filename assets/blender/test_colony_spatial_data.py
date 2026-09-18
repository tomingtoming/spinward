import copy
import json
import tempfile
import unittest
from pathlib import Path

from colony_manifest_io import encoded
from colony_spatial_data import partition, write_regions


def fixture():
    layer = {'vertices': [-2.0, 0.0, 1, 514.0, 0.0, 1, 0.0, 3.0, 1,
                          -2.0, -0.0, 1, -2.0, 0.0, 4],
             'meshes': {'walk': [0, 1, 2], 'wall': [3, 1, 4]},
             'surfaces': [{'indices': [0, 1, 2, 3, 1, 4], 'bounds': [-2, 0, 514, 3], 'groundSurface': False}]}
    return {'base': layer, 'cityBlocks': {'fixed': copy.deepcopy(layer)},
            'futureLayer': {'fixed': copy.deepcopy(layer)}}


def faces(packed):
    vertices = packed['vertices']
    return sorted(encoded([name, [vertices[i * 3:i * 3 + 3] for i in ids[j:j + 3]]])
                  for name, ids in packed['meshes'].items() for j in range(0, len(ids), 3))


class ColonySpatialDataTest(unittest.TestCase):
    def test_partition_preserves_winding_numeric_values_and_complete_cross_cell_compounds(self):
        source = fixture(); before = encoded(source)
        regions = partition(source, 128)
        expected = faces(source['base']) * 3
        self.assertEqual(sorted(expected), sorted(f for p in regions.values() for f in faces(p)))
        compounds = [(p, s) for p in regions.values() for s in p['surfaces']]
        self.assertEqual({s['id'] for _, s in compounds}, {'base:0', 'cityBlocks:0', 'futureLayer:0'})
        for packed, surface in compounds:
            restored = [packed['vertices'][i * 3:i * 3 + 3] for i in surface['indices']]
            original = [source['base']['vertices'][i * 3:i * 3 + 3] for i in source['base']['surfaces'][0]['indices']]
            self.assertEqual(encoded(restored), encoded(original))
            self.assertFalse(surface['groundSurface'])
            self.assertEqual(surface['bounds'], [-2, 0, 514, 3])
        self.assertEqual(encoded(source), before)

    def test_parts_are_bounded_deterministic_and_have_conservative_collision_metadata(self):
        with tempfile.TemporaryDirectory(prefix='spinward-region-') as temp:
            root = Path(temp)
            result = write_regions(root, fixture(), cell_size=128)
            self.assertEqual(result, write_regions(root, fixture(), cell_size=128))
            self.assertEqual(result['layers'], ['base', 'cityBlocks', 'futureLayer'])
            for region in result['regions']:
                data = (root / 'public' / region['url'][1:]).read_bytes()
                self.assertEqual(len(data), region['bytes'])
                packed = json.loads(data)
                for descriptor, surface in zip(region['surfaces'], packed['surfaces']):
                    self.assertEqual(descriptor['height'], 4)
                    self.assertNotIn('indices', descriptor)
                    self.assertNotIn('occupiedBounds', descriptor)
                    for i in surface['indices']:
                        px, py = packed['vertices'][i * 3:i * 3 + 2]
                        self.assertLessEqual(descriptor['bounds'][0], px)
                        self.assertLessEqual(descriptor['bounds'][1], py)
                        self.assertGreaterEqual(descriptor['bounds'][2], px)
                        self.assertGreaterEqual(descriptor['bounds'][3], py)
                if region['surfaces']:
                    self.assertLessEqual(region['bounds'][0], -2)
                    self.assertGreaterEqual(region['bounds'][2], 514)

    def test_oversized_or_corrupt_parts_do_not_publish_a_runtime_index_or_replace_source(self):
        with tempfile.TemporaryDirectory(prefix='spinward-region-') as temp:
            root = Path(temp)
            with self.assertRaisesRegex(ValueError, 'request budget'):
                write_regions(root, fixture(), byte_limit=20)
            self.assertFalse((root / 'public').exists())
            result = write_regions(root, fixture())
            part = root / 'public' / result['regions'][0]['url'][1:]
            part.write_bytes(b'corrupt')
            with self.assertRaisesRegex(ValueError, 'unexpected contents'):
                write_regions(root, fixture())
            self.assertEqual(part.read_bytes(), b'corrupt')
            self.assertFalse((root / 'src').exists())

    def test_catalog_covers_original_collision_bounds_with_extra_source_precision(self):
        source = fixture()
        source['base']['surfaces'][0]['bounds'] = [-2.000001, -.000001, 514.000001, 3.000001]
        with tempfile.TemporaryDirectory(prefix='spinward-region-') as temp:
            catalog = write_regions(Path(temp), source)
            region = next(r for r in catalog['regions'] if any(s['id'] == 'base:0' for s in r['surfaces']))
            self.assertEqual(region['bounds'], [-2.000001, -.000001, 514.000001, 3.000001])


if __name__ == '__main__':
    unittest.main()
