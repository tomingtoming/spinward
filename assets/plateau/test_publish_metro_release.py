import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from package_metro_release import Package, canonical
from publish_metro_release import verify_package, plan, publish, key_hash


class Store:
    def __init__(self):
        self.objects = {}
        self.data = {}
        self.failure = None
        self.writes = []

    def head(self, key):
        return self.objects.get(key)

    def put(self, key, data, entry):
        if key == self.failure:
            raise OSError('Simulated interrupted transfer')
        self.data[key] = data
        self.objects[key] = entry.copy()
        self.writes.append(key)


class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'source').mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def fixture(self, version, shared=b'shared'):
        directory = self.root / str(version)
        p = Package(self.root / 'source', directory)
        leaf = p.store(shared, '.png', 'image/png')
        extra = p.store(str(version).encode(), '.png', 'image/png')
        core = p.json_object({'texture': leaf, 'extra': extra})
        data = canonical({'core': core})
        digest = hashlib.sha256(data).hexdigest()
        release = f'releases/{digest}.json'
        path = p.public / release
        path.parent.mkdir()
        path.write_bytes(data)
        p.objects[release] = {'bytes': len(data), 'sha256': digest, 'contentType': 'application/json', 'cacheControl': 'public, max-age=31536000, immutable'}
        inventory = {'version': 1, 'release': release, 'objects': p.objects, 'bytes': sum(v['bytes'] for v in p.objects.values())}
        (directory / 'inventory.json').write_bytes(canonical(inventory))
        return directory, inventory, extra

    def test_interrupted_update_resume_and_rollback(self):
        a, old, _ = self.fixture(1)
        b, new, failed = self.fixture(2)
        store = Store()
        publish(a, verify_package(a), store, workers=1)
        old_bytes = store.data[old['release']]
        self.assertEqual(store.writes[-1], old['release'])
        store.failure = failed
        with self.assertRaises(OSError):
            publish(b, verify_package(b), store, workers=1)
        self.assertNotIn(new['release'], store.objects)
        self.assertEqual(store.data[old['release']], old_bytes)
        store.failure = None
        result = publish(b, verify_package(b), store, workers=1)
        self.assertGreater(result['reused'], 0)
        self.assertEqual(store.writes[-1], new['release'])
        self.assertEqual(publish(b, new, store, workers=1)['uploaded'], 0)
        # Rollback pins the unchanged older manifest; no overwrite or deletion.
        self.assertEqual(publish(a, old, store, workers=1)['uploaded'], 0)
        self.assertEqual(store.data[old['release']], old_bytes)

    def test_dry_run_allowlist_and_remote_header_mismatch(self):
        directory, inventory, _ = self.fixture(1)
        (directory / 'public' / 'secret.sqlite').write_bytes(b'not published')
        checked = verify_package(directory)
        pending = plan(checked, {})
        self.assertEqual(pending['upload'][-1], inventory['release'])
        self.assertNotIn('secret.sqlite', pending['upload'])
        remote = json.loads(json.dumps(inventory['objects']))
        remote[inventory['release']]['contentEncoding'] = 'gzip'
        with self.assertRaisesRegex(ValueError, 'metadata mismatch'):
            plan(checked, remote)

    def test_failure_stops_dispatch_and_never_publishes_manifest(self):
        directory, inventory, _ = self.fixture(1)
        store = Store()
        store.failure = next(iter(inventory['objects']))
        with self.assertRaisesRegex(OSError, 'interrupted'):
            publish(directory, inventory, store, workers=1)
        self.assertEqual(store.writes, [])
        self.assertNotIn(inventory['release'], store.objects)
        store.failure = None
        progress = []
        result = publish(directory, inventory, store, workers=2, progress=progress.append)
        self.assertEqual(result['uploaded'], len(inventory['objects']))
        self.assertEqual(progress[-1]['completed'], len(inventory['objects']) - 1)
        self.assertEqual(store.writes[-1], inventory['release'])
        progress.clear()
        publish(directory, inventory, store, workers=2, progress=progress.append)
        self.assertEqual(progress[-1]['uploadedBytes'], 0)
        self.assertEqual(progress[-1]['reused'], len(inventory['objects']) - 1)

    def test_missing_tampered_and_orphaned_objects_rejected(self):
        directory, inventory, extra = self.fixture(1)
        original = (directory / 'public' / extra).read_bytes()
        (directory / 'public' / extra).write_bytes(b'broken')
        with self.assertRaisesRegex(ValueError, 'Corrupt release'):
            verify_package(directory)
        (directory / 'public' / extra).write_bytes(original)
        del inventory['objects'][extra]
        (directory / 'inventory.json').write_bytes(canonical(inventory))
        with self.assertRaisesRegex(ValueError, 'Missing release reference'):
            verify_package(directory)
        for key in ['../secret.sqlite', 'objects/aa/'+'b'*64+'.png', '/releases/'+'a'*64+'.json']:
            with self.assertRaises(ValueError):
                key_hash(key)


if __name__ == '__main__':
    unittest.main()
