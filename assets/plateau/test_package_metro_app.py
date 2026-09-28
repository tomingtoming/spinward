import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from package_metro_app import stage


class AppPackageTest(unittest.TestCase):
    def fixture(self, root):
        build, shared = root / 'build', root / 'shared'
        (build / '.vite').mkdir(parents=True)
        (build / 'assets').mkdir()
        (shared / 'public').mkdir(parents=True)
        release = 'releases/' + 'a' * 64 + '.json'
        script = f'const pin="{release}",root="/metro-data/";import("./metro-xyz.js");new Worker("/assets/tile-worker-xyz.js")'
        (build / 'assets/main-xyz.js').write_text(script)
        (build / 'assets/metro-xyz.js').write_text('export const metro=true')
        (build / 'assets/tile-worker-xyz.js').write_text('onmessage=()=>{}')
        (build / 'index.html').write_text('<script src="/assets/main-xyz.js"></script>')
        for p in [build / '_headers', shared / 'public/_headers']:
            p.write_text('/*\n  Cache-Control: no-cache\n')
        (build / '.vite/manifest.json').write_text(json.dumps({
            'index.html': {'file': 'assets/main-xyz.js', 'isEntry': True, 'dynamicImports': ['metro']},
            'metro': {'file': 'assets/metro-xyz.js'}}))
        (build / 'icon.png').write_bytes(b'pixels')
        (shared / 'shared-index.json').write_text(json.dumps({'version': 1, 'root': '/shared/' + 'b' * 64,
            'objects': {'icon.png': {'bytes': 6, 'sha256': hashlib.sha256(b'pixels').hexdigest()}}}))
        return build, shared, release

    def test_closure_includes_worker_but_excludes_metadata_and_unlisted_files(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            build, shared, release = self.fixture(root)
            for name in ['._index.html', 'secret.sqlite', 'assets/unused.js', 'assets/main-xyz.js.map']:
                (build / name).write_text('not public')
            a = stage(build, shared, root / 'a', release, '/metro-data/')
            b = stage(build, shared, root / 'b', release, '/metro-data/')
            self.assertEqual(a, b)
            self.assertEqual(set(a['objects']), {'index.html', '_headers', '.assetsignore', 'icon.png',
                'assets/main-xyz.js', 'assets/metro-xyz.js', 'assets/tile-worker-xyz.js'})
            with self.assertRaisesRegex(ValueError, 'new app'):
                stage(build, shared, root / 'a', release, '/metro-data/')

    def test_rejects_missing_dependency_wrong_pin_and_changed_shared_asset(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            build, shared, release = self.fixture(root)
            with self.assertRaisesRegex(ValueError, 'requested release'):
                stage(build, shared, root / 'bad', release, 'https://example.com/')
            (build / 'icon.png').write_bytes(b'edited')
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                stage(build, shared, root / 'bad', release, '/metro-data/')
            (build / 'assets/metro-xyz.js').unlink()
            with self.assertRaises(FileNotFoundError):
                stage(build, shared, root / 'bad', release, '/metro-data/')

    def test_rejects_paths_outside_build(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            build, shared, release = self.fixture(root)
            (root / 'outside.js').write_text('private')
            (build / 'assets/metro-xyz.js').unlink()
            (build / 'assets/metro-xyz.js').symlink_to(root / 'outside.js')
            with self.assertRaisesRegex(ValueError, 'outside build'):
                stage(build, shared, root / 'bad', release, '/metro-data/')


if __name__ == '__main__':
    unittest.main()
