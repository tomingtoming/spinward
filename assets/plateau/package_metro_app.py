"""Stage only Vite's reachable output and checksum-verified shared assets.

The returned public/ is the Wrangler asset root. The inventory and build
manifest stay outside it. External-drive AppleDouble files are never selected.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re


def read_inside(root, name):
    parts = PurePosixPath(name).parts
    if not parts or name.startswith('/') or '..' in parts or '\\' in name or any(p.startswith('.') for p in parts):
        raise ValueError(f'Invalid public path: {name}')
    file = (root / name).resolve(strict=True)
    if not file.is_relative_to(root) or not file.is_file():
        raise ValueError(f'Path outside build: {name}')
    return file.read_bytes()


def stage(build, shared, output, release, data_root):
    build, shared = Path(build).resolve(strict=True), Path(shared).resolve(strict=True)
    output = Path(output).resolve()
    if any(output == p or p in output.parents or output in p.parents for p in (build, shared)):
        raise ValueError('Use a separate app staging directory')
    if output.exists():
        raise ValueError('Use a new app staging directory')
    if not re.fullmatch(r'releases/[a-f0-9]{64}\.json', release):
        raise ValueError('Expected an immutable release pin')
    if not data_root.startswith(('https://', '/')) or not data_root.endswith('/'):
        raise ValueError('Expected an explicit HTTPS or root-relative data root')
    manifest = json.loads((build / '.vite/manifest.json').read_bytes())
    index = json.loads((shared / 'shared-index.json').read_bytes())
    if index['version'] != 1 or not re.fullmatch(r'/shared/[a-f0-9]{64}', index['root']):
        raise ValueError('Invalid shared index')
    names, visited = {'index.html', '_headers'}, set()
    queue = [key for key, row in manifest.items() if row.get('isEntry')]
    if not queue:
        raise ValueError('No Vite entry')
    while queue:
        key = queue.pop()
        if key in visited:
            continue
        visited.add(key)
        row = manifest[key]
        names.add(row['file'])
        names.update(row.get('css', []))
        names.update(row.get('assets', []))
        queue.extend(row.get('imports', []) + row.get('dynamicImports', []))
    payload = {name: read_inside(build, name) for name in names}
    # Worker output is referenced by generated JS rather than Vite's main
    # manifest import graph. Only hashed JS workers explicitly referenced there
    # may be added; arbitrary JS files in the output directory are not copied.
    worker_pattern = re.compile(rb'assets/(tile-worker-[A-Za-z0-9_-]+\.js)')
    for content in list(payload.values()):
        for match in worker_pattern.finditer(content):
            name = 'assets/' + match[1].decode()
            payload[name] = read_inside(build, name)
    scripts = b'\n'.join(data for name, data in payload.items() if name.endswith('.js'))
    if release.encode() not in scripts or data_root.encode() not in scripts:
        raise ValueError('App build does not contain the requested release and data root')
    for name, expected in index['objects'].items():
        candidates = [name, index['root'].lstrip('/') + '/' + name]
        existing = [n for n in candidates if (build / n).is_file()]
        if len(existing) != 1:
            raise ValueError(f'Missing or ambiguous shared asset: {name}')
        data = read_inside(build, existing[0])
        if len(data) != expected['bytes'] or hashlib.sha256(data).hexdigest() != expected['sha256']:
            raise ValueError(f'Shared asset checksum mismatch: {name}')
        payload[existing[0]] = data
    if payload['_headers'] != (shared / 'public/_headers').read_bytes():
        raise ValueError('Shared cache headers changed')
    # Also guard against metadata created after staging on an external volume.
    payload['.assetsignore'] = b'**/._*\n**/.DS_Store\n'
    objects = {name: {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
               for name, data in sorted(payload.items())}
    canonical = json.dumps(objects, sort_keys=True, separators=(',', ':')).encode()
    result = {'version': 1, 'sha256': hashlib.sha256(canonical).hexdigest(), 'release': release,
              'dataRoot': data_root, 'objects': objects, 'bytes': sum(v['bytes'] for v in objects.values())}
    output.mkdir()
    for name, data in payload.items():
        file = output / 'public' / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)
        if hashlib.sha256(file.read_bytes()).hexdigest() != objects[name]['sha256']:
            raise ValueError('App copy changed')
    (output / 'inventory.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ['build', 'shared', 'output', 'release', 'data-root']:
        parser.add_argument('--' + arg, required=True)
    a = parser.parse_args()
    result = stage(a.build, a.shared, a.output, a.release, a.data_root)
    print(json.dumps({k: len(v) if k == 'objects' else v for k, v in result.items()}, indent=2))
