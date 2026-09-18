"""Native persistence checks; python3 -m unittest discover -s assets/blender -p test_colony_manifest_io.py."""
import json
import tempfile
import unittest
from pathlib import Path
from colony_manifest_io import PART_LIMIT, encoded, read_manifest, write_manifest


class ColonyManifestPersistence(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='spinward-colony-io-')
        self.root = Path(self.directory.name)
        self.path = self.root / 'src/worlds/generated/izmaColony.json'
        self.path.parent.mkdir(parents=True)

    def tearDown(self):
        self.directory.cleanup()

    def test_large_native_arrays_round_trip_without_changing_values_or_numeric_types(self):
        original = {'version': 1, 'vertices': [i / 8 for i in range(300000)],
                    'nested': {'mixed': [1, 1.0, -0.0, -123456.78901], 'label': '住居帯'}}
        report = write_manifest(self.path, original)
        self.assertGreater(report['parts'], 1)
        self.assertLessEqual(report['largestPartBytes'], PART_LIMIT)
        self.assertEqual(encoded(read_manifest(self.path)), encoded(original))
        before = self.path.read_bytes()
        files = set((self.root / 'public').rglob('*.json'))
        write_manifest(self.path, original)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(set((self.root / 'public').rglob('*.json')), files)

    def test_failed_export_preserves_the_last_complete_index(self):
        previous = {'version': 1, 'vertices': [1.0, 2.0, 3.0]}
        write_manifest(self.path, previous)
        before = self.path.read_bytes()
        with self.assertRaisesRegex(ValueError, 'Oversized'):
            write_manifest(self.path, {'newTerrain': [float(i) for i in range(60000)],
                                       'oversized': 'x' * (PART_LIMIT + 1)})
        self.assertTrue(list((self.root / 'public').rglob('*.json')))
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(read_manifest(self.path), previous)

    def test_corruption_is_detected_and_not_silently_overwritten(self):
        original = {'vertices': [float(i) for i in range(60000)]}
        write_manifest(self.path, original)
        before = self.path.read_bytes()
        part = next((self.root / 'public').rglob('*.json'))
        content = bytearray(part.read_bytes()); content[1] = ord('9'); part.write_bytes(content)
        with self.assertRaisesRegex(ValueError, 'Corrupt'):
            read_manifest(self.path)
        with self.assertRaisesRegex(ValueError, 'unexpected contents'):
            write_manifest(self.path, original)
        self.assertEqual(self.path.read_bytes(), before)

    def test_legacy_input_and_rejection_of_nonlocal_part_paths(self):
        self.path.write_bytes(encoded({'version': 1, 'vertices': [1, 2, 3]}))
        self.assertEqual(read_manifest(self.path)['vertices'], [1, 2, 3])
        write_manifest(self.path, {'vertices': [float(i) for i in range(60000)]})
        document = json.loads(self.path.read_text())
        document['data']['vertices']['$part'] = '/../../outside.json'
        self.path.write_bytes(encoded(document))
        with self.assertRaisesRegex(ValueError, 'Invalid colony part reference'):
            read_manifest(self.path)


if __name__ == '__main__':
    unittest.main()
