"""Lossless, content-addressed JSON parts shared by native authoring and the web.

Keep the authored numeric values and order intact. Each request is bounded;
there is no private numeric codec and ordinary HTTP compression still applies.
The header is replaced only after every referenced part has been written.
"""
import hashlib
import json
import re
from pathlib import Path

FORMAT = 'colony-json-parts-v1'
PART_LIMIT = 2 * 1024 * 1024
EXTERNAL_THRESHOLD = 256 * 1024
PART_URL = re.compile(r'^/landscapes/izma/data-([a-f0-9]{64})\.json$')


def encoded(value):
    return (json.dumps(value, separators=(',', ':')) + '\n').encode()


def read_manifest(path):
    path = Path(path)
    document = json.loads(path.read_text())
    if document.get('storage') != FORMAT:
        return document
    public = path.parents[3] / 'public'
    loaded = {}

    def expand(value):
        if isinstance(value, list):
            return [expand(v) for v in value]
        if not isinstance(value, dict):
            return value
        if '$part' in value:
            url = value['$part']
            match = PART_URL.fullmatch(url)
            if not match or set(value) != {'$part', 'bytes'}:
                raise ValueError('Invalid colony part reference')
            if url not in loaded:
                data = (public / url[1:]).read_bytes()
                if len(data) != value['bytes'] or hashlib.sha256(data).hexdigest() != match[1]:
                    raise ValueError('Corrupt colony part: ' + url)
                loaded[url] = json.loads(data)
            return loaded[url]
        if '$concat' in value:
            if set(value) != {'$concat'} or not isinstance(value['$concat'], list):
                raise ValueError('Invalid colony concatenation')
            result = []
            for part in value['$concat']:
                values = expand(part)
                if not isinstance(values, list):
                    raise ValueError('Colony array part is not an array')
                result.extend(values)
            return result
        return {key: expand(v) for key, v in value.items()}

    result = expand(document['data'])
    if hashlib.sha256(encoded(result)).hexdigest() != document['sourceSha256']:
        raise ValueError('Colony assembly does not match the native source')
    return result


def write_manifest(path, manifest):
    path = Path(path)
    public = path.parents[3] / 'public'
    parts = {}

    def emit(value):
        data = encoded(value)
        if len(data) > PART_LIMIT:
            raise ValueError('Colony JSON part exceeds the request budget')
        digest = hashlib.sha256(data).hexdigest()
        url = '/landscapes/izma/data-' + digest + '.json'
        target = public / url[1:]
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if target.read_bytes() != data:
                raise ValueError('Existing colony part has unexpected contents: ' + url)
        else:
            target.write_bytes(data)
        parts[url] = len(data)
        return {'$part': url, 'bytes': len(data)}

    def partition(value):
        size = len(encoded(value))
        if size < EXTERNAL_THRESHOLD:
            return value
        if size <= PART_LIMIT:
            return emit(value)
        if isinstance(value, dict):
            return {key: partition(v) for key, v in value.items()}
        if not isinstance(value, list):
            raise ValueError('Oversized indivisible colony value')
        # Array slices retain exact order, float/int representation and values.
        slices = []
        current = []
        current_bytes = 3  # brackets and newline
        for item in value:
            item_bytes = len(encoded(item)) - 1
            if item_bytes + 3 > PART_LIMIT:
                raise ValueError('Oversized colony array element')
            extra = item_bytes + (1 if current else 0)
            if current and current_bytes + extra > PART_LIMIT:
                slices.append(emit(current))
                current = []
                current_bytes = 3
                extra = item_bytes
            current.append(item)
            current_bytes += extra
        if current:
            slices.append(emit(current))
        return {'$concat': slices}

    # Leave the root object addressable for later layer/region loading.
    data = {key: partition(value) for key, value in manifest.items()}
    document = {'storage': FORMAT, 'sourceSha256': hashlib.sha256(encoded(manifest)).hexdigest(),
                'sourceBytes': len(encoded(manifest)), 'parts': len(parts),
                'partBytes': sum(parts.values()), 'data': data}
    pending = path.with_suffix(path.suffix + '.next')
    pending.write_bytes(encoded(document))
    # Exercise the real reader before replacing the last complete index.
    if encoded(read_manifest(pending)) != encoded(manifest):
        raise ValueError('Colony source round trip failed')
    pending.replace(path)
    return {'indexBytes': path.stat().st_size, 'parts': len(parts),
            'partBytes': sum(parts.values()), 'largestPartBytes': max(parts.values(), default=0),
            'sourceSha256': document['sourceSha256']}
