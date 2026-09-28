"""Export a closed, immutable runtime dataset. Never copy the source tree wholesale."""
from pathlib import Path, PurePosixPath
import argparse
import gzip
import hashlib
import json
import os
import struct


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True, allow_nan=False).encode()


class Package:
    def __init__(self, source, output):
        self.source = Path(source).resolve(strict=True)
        self.output = Path(output).resolve()
        if self.output == self.source or self.source in self.output.parents:
            raise ValueError('Package output must be outside the source data')
        self.public = self.output / 'public'
        self.objects = {}
        self.sources = {}
        self.source_hashes = {}
        self.decoded_sizes = {}
        self.textures = {}
        self.finish_textures = {}
        self.public.mkdir(parents=True, exist_ok=True)

    def source_path(self, name):
        path = PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts or '\\' in name or any(p.startswith('.') for p in path.parts):
            raise ValueError(f'Invalid source path: {name}')
        target = (self.source / name).resolve(strict=True)
        if not target.is_relative_to(self.source) or not target.is_file():
            raise ValueError(f'Not a source file: {name}')
        return target

    def read(self, name):
        return json.loads(self.source_path(name).read_bytes())

    def store(self, data, extension, content_type):
        sha = hashlib.sha256(data).hexdigest()
        key = f'objects/{sha[:2]}/{sha}{extension}'
        target = self.public / key
        if target.exists():
            if target.stat().st_size != len(data) or hashlib.sha256(target.read_bytes()).hexdigest() != sha:
                raise ValueError(f'Corrupt existing immutable object: {key}')
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_name(target.name + f'.{os.getpid()}.tmp')
            try:
                temporary.write_bytes(data)
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)
        self.objects[key] = {'bytes': len(data), 'sha256': sha, 'contentType': content_type,
                             'cacheControl': 'public, max-age=31536000, immutable'}
        return key

    def asset(self, name):
        if name in self.sources:
            return self.sources[name]
        path = self.source_path(name)
        allowed = {'.bin.gz': 'application/octet-stream', '.json.gz': 'application/gzip',
                   '.png': 'image/png', '.geojson': 'application/geo+json'}
        extension = next((e for e in allowed if name.endswith(e)), None)
        if not extension:
            raise ValueError(f'Not an allowed runtime asset: {name}')
        data = path.read_bytes()
        decoded = gzip.decompress(data) if extension.endswith('.gz') else data
        self.source_hashes[name] = {hashlib.sha256(data).hexdigest(), hashlib.sha256(decoded).hexdigest()}
        self.decoded_sizes[name] = len(decoded)
        # .gz is an opaque compressed object. No Content-Encoding header is
        # attached: runtime detects gzip exactly once, independent of the CDN.
        key = self.store(data, extension, allowed[extension])
        self.sources[name] = key
        if extension == '.bin.gz':
            length = struct.unpack('<I', decoded[:4])[0]
            if length > 8 * 1024 * 1024 or length + 4 > len(decoded):
                raise ValueError(f'Invalid tile header: {name}')
            header = json.loads(decoded[4:4+length])
            refs = {mesh['texture']: self.asset(self.finish_textures.get(mesh['texture'], mesh['texture']))
                    for mesh in header['meshes'] if mesh.get('texture')}
            if refs:
                self.textures[name] = refs
        return key

    def descriptor(self, value):
        name = value['path']
        path = self.asset(name)
        # Existing producers hash either the transport or the decoded payload.
        # Verify their checksum; the new object key always hashes stored bytes.
        if value.get('sha256') and value['sha256'] not in self.source_hashes[name]:
            raise ValueError(f'Source checksum changed: {name}')
        if value.get('decodedBytes') is not None and value['decodedBytes'] != self.decoded_sizes[name]:
            raise ValueError(f'Source decoded length changed: {name}')
        # Bounds are kept verbatim: rounding here would change collision demand.
        out = {k: value[k] for k in ['id', 'band', 'bounds', 'heightRange', 'decodedBytes', 'bytes', 'instances', 'tiles'] if k in value}
        out['path'] = path
        if name in self.textures:
            out['textures'] = self.textures[name]
        return out

    def json_object(self, value):
        data = gzip.compress(canonical(value), compresslevel=6, mtime=0)
        return self.store(data, '.json.gz', 'application/gzip')

    def build(self):
        finish = self.read('finish-v1/manifest.json')
        self.finish_textures = finish['textures']
        study = self.read('metro-overview.json')
        samples = []
        geometry = {}
        far_catalogs = {}
        details = {}
        panes = self.read('night-panes-v1/manifest.json')
        for s in study['samples']:
            band = s['id']
            base = self.read(f'{band}/base.json')
            geometry[band] = {**{k: v for k, v in base.items() if k not in ['tiles', 'farTiles']},
                              'tiles': [self.descriptor(t) for t in base['tiles']]}
            far_catalogs[band] = self.json_object({'version': 1, 'band': band, 'frame': s['frame'],
                                                  'tiles': [self.descriptor(t) for t in base['farTiles']]})
            samples.append({**{k: v for k, v in s.items() if k not in ['tiles', 'overview']},
                            'tiles': [{'id': t['id'], 'bounds': t['bounds']} for t in s['tiles']],
                            'overview': [self.descriptor(t) for t in s['overview']]})
            facade = self.read(f'stations-v6/{band}.json')
            facade.pop('kit', None)
            facade['sites'] = [self.descriptor(t) for t in facade['sites']]
            details[band] = self.json_object({'version': 1, 'band': band,
                                             'frame': s['frame'], 'facades': facade,
                                             'panes': [self.descriptor(t) for t in panes['bands'][band]]})
        study = {**study, 'samples': samples}
        finish = {**{k: v for k, v in finish.items() if k not in ['textures', 'surfaces', 'landmarks', 'trees', 'derivedSource']},
                  'surfaces': {band: {'tiles': [self.descriptor(t) for t in data['tiles']]}
                               for band, data in finish['surfaces'].items()},
                  'landmarks': [self.descriptor(t) for t in finish['landmarks']],
                  'trees': self.json_object(self.read(finish['trees'])),
                  'derivedSource': self.asset(finish['derivedSource'])}
        lowrise = self.read('render-v2/lowrise/manifest.json')
        lowrise = {**lowrise, 'bands': {b: [self.descriptor(t) for t in rows] for b, rows in lowrise['bands'].items()},
                   'bootstrap': {b: self.descriptor(t) for b, t in lowrise['bootstrap'].items()}}
        night = self.read('night-v2/manifest.json')
        night = {**night, 'bands': {b: {**{k: v for k, v in row.items() if k not in ['segments', 'lamps', 'pools', 'walls']},
                                      'lamps': self.descriptor(row['lamps']),
                                      'pools': self.asset(row['pools']), 'walls': self.asset(row['walls'])}
                                   for b, row in night['bands'].items()},
                 'obstruction': self.read('obstruction-v1/manifest.json')}
        roads = self.read('roads-v2/network.json')
        roads = {**roads, 'bridges': [self.descriptor(t) for t in roads['bridges']]}
        core = {'version': 1, 'study': study, 'arrivals': self.read('metro-arrivals.json'),
                'kit': self.read('stations-v6/kit.json'), 'geometry': geometry,
                'finish': finish, 'lowrise': lowrise, 'roads': roads, 'night': night,
                'roadSource': self.asset('roads-v2/network.geojson'), 'details': details, 'far': far_catalogs}
        return self.write_release(core)

    def write_release(self, core):
        study, finish = core['study'], core['finish']
        core_path = self.json_object(core)
        release = {'schema': 'spinward-metro-release', 'version': 1, 'core': core_path,
                   'coreSha256': self.objects[core_path]['sha256'],
                   'source': {'layout': study['layout'], 'radius': study['radius'], 'span': study['span']},
                   'attribution': {'plateau': 'https://www.mlit.go.jp/plateau/',
                                   'gsi': 'https://www.gsi.go.jp/',
                                   'osm': 'https://www.openstreetmap.org/copyright',
                                   'derivedSource': [finish['derivedSource'], core['roadSource']]}}
        release_id = hashlib.sha256(canonical(release)).hexdigest()
        key = f'releases/{release_id}.json'
        data = canonical(release)
        target = self.public / key
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and target.read_bytes() != data:
            raise ValueError('Immutable release already exists with different content')
        temporary = target.with_name(target.name + f'.{os.getpid()}.tmp')
        temporary.write_bytes(data)
        temporary.replace(target)
        self.objects[key] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                             'contentType': 'application/json', 'cacheControl': 'public, max-age=31536000, immutable'}
        inventory = {'version': 1, 'release': key, 'objects': self.objects, 'sourceObjects': self.sources,
                     'bytes': sum(x['bytes'] for x in self.objects.values())}
        # This local inventory is for audit/upload only, never a public catalog.
        temporary = self.output / f'inventory.{os.getpid()}.tmp'
        temporary.write_bytes(canonical(inventory))
        temporary.replace(self.output / 'inventory.json')
        return {'release': key, 'objects': len(self.objects), 'bytes': inventory['bytes'],
                'coreBytes': self.objects[core_path]['bytes'], 'detailBytes': {b: self.objects[p]['bytes'] for b, p in core['details'].items()}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(Package(args.source, args.output).build(), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
