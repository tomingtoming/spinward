import json
from pathlib import Path
import struct
import tempfile
import unittest

from package_metro_shared import stage


class SharedReleaseTest(unittest.TestCase):
    def test_models_require_selected_external_images_and_never_copy_unlisted_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source'
            (source / 'assets').mkdir(parents=True)
            header = json.dumps({'images': [{'uri': 'texture.png'}]}).encode()
            glb = b'glTF' + struct.pack('<IIII', 2, 20 + len(header), len(header), 0x4e4f534a) + header
            (source / 'assets/model.glb').write_bytes(glb)
            (source / 'assets/texture.png').write_bytes(b'pixels')
            (source / 'secret.sqlite').write_bytes(b'not public')
            selection = root / 'selection.json'
            selection.write_text(json.dumps({'assets': ['assets/model.glb'], 'site': []}))
            with self.assertRaisesRegex(ValueError, 'Missing GLTF dependency'):
                stage(source, root / 'bad', selection)
            selection.write_text(json.dumps({'assets': ['assets/model.glb', 'assets/texture.png'], 'site': []}))
            a = stage(source, root / 'a', selection)
            b = stage(source, root / 'b', selection)
            self.assertEqual(a, b)
            self.assertFalse(list((root / 'a').rglob('*.sqlite')))
            self.assertEqual((root / 'a/public' / a['root'].lstrip('/') / 'assets/model.glb').read_bytes(), glb)
            with self.assertRaisesRegex(ValueError, 'new output'):
                stage(source, root / 'a', selection)


if __name__ == '__main__':
    unittest.main()
