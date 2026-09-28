import gzip
import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest

from package_metro_release import Package


class PackagingTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.output = self.root / 'output'
        self.package = Package(self.source, self.output)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, name, data):
        p = self.source / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def test_dedup_resume_and_corruption(self):
        self.write('a.png', b'pixels')
        self.write('b.png', b'pixels')
        key = self.package.asset('a.png')
        self.assertEqual(key, self.package.asset('b.png'))
        resumed = Package(self.source, self.output)
        self.assertEqual(resumed.asset('a.png'), key)
        (resumed.public / key).write_bytes(b'broken')
        with self.assertRaisesRegex(ValueError, 'Corrupt existing'):
            Package(self.source, self.output).asset('a.png')

    def test_excludes_secrets_traversal_missing_and_symlink_escape(self):
        self.write('db.sqlite', b'source')
        (self.root / 'outside.png').write_bytes(b'secret')
        (self.source / 'escape.png').symlink_to(self.root / 'outside.png')
        for p in ['../outside.png', str(self.root / 'outside.png'), 'escape.png', '.secret.png', 'db.sqlite', 'absent.png']:
            with self.subTest(path=p), self.assertRaises((ValueError, FileNotFoundError)):
                self.package.asset(p)
        self.assertEqual(self.package.objects, {})

    def test_embedded_texture_remapping_and_legacy_hash_scopes(self):
        self.write('old.png', b'old')
        self.write('finished.png', b'finished')
        header = json.dumps({'meshes': [{'texture': 'old.png'}]}).encode()
        decoded = struct.pack('<I', len(header)) + header
        packed = gzip.compress(decoded, mtime=0)
        self.write('tile.bin.gz', packed)
        self.package.finish_textures = {'old.png': 'finished.png'}
        for hashed in [decoded, packed]:
            descriptor = self.package.descriptor({'path': 'tile.bin.gz', 'decodedBytes': len(decoded), 'bytes': len(decoded), 'sha256': hashlib.sha256(hashed).hexdigest()})
            self.assertEqual(descriptor['textures']['old.png'], self.package.sources['finished.png'])
            self.assertEqual(descriptor['bytes'], len(decoded))
        self.assertNotIn('old.png', self.package.sources)
        with self.assertRaisesRegex(ValueError, 'checksum changed'):
            self.package.descriptor({'path': 'tile.bin.gz', 'sha256': '0' * 64})
        with self.assertRaisesRegex(ValueError, 'decoded length'):
            self.package.descriptor({'path': 'tile.bin.gz', 'decodedBytes': 1})

    def test_reproducible_json_and_separate_output(self):
        first = self.package.json_object({'b': 1, 'a': 2})
        self.assertEqual(first, self.package.json_object({'a': 2, 'b': 1}))
        self.assertNotIn('contentEncoding', self.package.objects[first])
        with self.assertRaisesRegex(ValueError, 'outside'):
            Package(self.source, self.source / 'package')


if __name__ == '__main__':
    unittest.main()
