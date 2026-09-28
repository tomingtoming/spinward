"""Stage explicitly selected app assets, preserving relative GLTF dependencies."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import struct

from package_metro_release import canonical


def stage(source, output, selection):
    source, output = Path(source).resolve(strict=True), Path(output).resolve()
    if source == output or source in output.parents or output in source.parents:
        raise ValueError('Use a separate shared-asset staging directory')
    if (output / 'public').exists():
        raise ValueError('Use a new output directory; never merge app releases')
    selected = json.loads(Path(selection).read_bytes())
    files = {}
    for name in selected['assets'] + selected['site']:
        if PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts or '\\' in name:
            raise ValueError(f'Invalid shared asset path: {name}')
        path = (source / name).resolve(strict=True)
        if not path.is_relative_to(source) or path.suffix not in ['.glb', '.png', '.jpg', '.json', '.webmanifest', '.txt']:
            raise ValueError(f'Not a public shared asset: {name}')
        data = path.read_bytes()
        files[name] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        if name.endswith('.glb'):
            if data[:4] != b'glTF':
                raise ValueError(f'Not a GLB: {name}')
            length = struct.unpack('<I', data[12:16])[0]
            document = json.loads(data[20:20+length])
            for item in document.get('images', []) + document.get('buffers', []):
                uri = item.get('uri', '')
                if uri and not uri.startswith('data:'):
                    dependency = (PurePosixPath(name).parent / uri).as_posix()
                    if dependency not in selected['assets']:
                        raise ValueError(f'Missing GLTF dependency: {dependency}')
    digest = hashlib.sha256(canonical(files)).hexdigest()
    prefix = f'shared/{digest}'
    for name in files:
        target = output / 'public' / (prefix if name in selected['assets'] else '') / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / name, target)
        if hashlib.sha256(target.read_bytes()).hexdigest() != files[name]['sha256']:
            raise ValueError(f'Shared asset copy changed: {name}')
    (output / 'public' / '_headers').write_text('/*\n  Cache-Control: no-cache\n/shared/*\n  Cache-Control: public, max-age=31536000, immutable\n/assets/*.js\n  Cache-Control: public, max-age=31536000, immutable\n/assets/*.css\n  Cache-Control: public, max-age=31536000, immutable\n')
    result = {'version': 1, 'root': '/' + prefix, 'objects': files, 'bytes': sum(v['bytes'] for v in files.values())}
    (output / 'shared-index.json').write_bytes(canonical(result))
    return {'root': result['root'], 'files': len(files), 'bytes': result['bytes']}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    p.add_argument('--selection', default=Path(__file__).with_name('metro-shared-assets.json'), type=Path)
    a = p.parse_args()
    print(json.dumps(stage(a.source, a.output, a.selection), indent=2))


if __name__ == '__main__':
    main()
