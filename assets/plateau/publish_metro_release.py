"""Verify a closed release; dry-run by default. Upload objects before its manifest.

R2 execution requires boto3 and explicit --apply --endpoint --bucket. Credentials
use the AWS SDK's normal environment/profile chain; they are never logged.
No bucket, domain, cache rule, application deployment or deletion is performed.
"""
import argparse
import base64
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import gzip
import hashlib
import json
from pathlib import Path
import re
from threading import Event
import time

KEY = re.compile(r'^(?:objects/([a-f0-9]{2})/([a-f0-9]{64})\.(?:bin\.gz|json\.gz|png|geojson)|releases/([a-f0-9]{64})\.json)$')


def key_hash(key):
    match = KEY.fullmatch(key)
    if not match or (match[1] and match[1] != match[2][:2]):
        raise ValueError(f'Not a public immutable key: {key}')
    return match[2] or match[3]


def references(value):
    if isinstance(value, str):
        if value.startswith(('objects/', 'releases/')):
            key_hash(value)
            yield value
        if value.startswith(('/Users/', '/Volumes/', '/private/', '/tmp/')):
            raise ValueError('Local source path in public JSON')
    elif isinstance(value, dict):
        for v in value.values():
            yield from references(v)
    elif isinstance(value, list):
        for v in value:
            yield from references(v)


def verify_package(directory):
    directory = Path(directory).resolve(strict=True)
    inventory = json.loads((directory / 'inventory.json').read_bytes())
    root = (directory / 'public').resolve(strict=True)
    objects = inventory['objects']
    if inventory['version'] != 1 or not inventory['release'].startswith('releases/'):
        raise ValueError('Invalid release inventory')
    refs = {}
    for key, entry in objects.items():
        expected = key_hash(key)
        path = (root / key).resolve(strict=True)
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError(f'Invalid public file: {key}')
        try:
            data = path.read_bytes()
        except OSError as error:
            raise OSError(f'Cannot read immutable object {path}: {error}') from error
        if len(data) != entry['bytes'] or hashlib.sha256(data).hexdigest() != expected or expected != entry['sha256']:
            raise ValueError(f'Corrupt release object: {key}')
        if entry.get('contentEncoding') or entry['cacheControl'] != 'public, max-age=31536000, immutable':
            raise ValueError(f'Invalid delivery headers: {key}')
        if key.endswith('.json') or key.endswith('.json.gz'):
            value = json.loads(gzip.decompress(data) if key.endswith('.gz') else data)
            refs[key] = set(references(value))
    reachable, queue = set(), [inventory['release']]
    while queue:
        key = queue.pop()
        if key in reachable:
            continue
        if key not in objects:
            raise ValueError(f'Missing release reference: {key}')
        reachable.add(key)
        queue.extend(refs.get(key, ()))
    if reachable != set(objects):
        raise ValueError(f'Unreferenced objects in publish inventory: {len(set(objects) - reachable)}')
    if inventory['bytes'] != sum(v['bytes'] for v in objects.values()):
        raise ValueError('Invalid inventory byte total')
    return inventory


def plan(inventory, remote):
    """Remote is a verified metadata snapshot, not a size-only bucket listing."""
    missing = []
    for key, entry in inventory['objects'].items():
        if key in remote:
            if remote[key] != entry:
                raise ValueError(f'Immutable remote metadata mismatch: {key}')
        else:
            missing.append(key)
    # Publication is last, and it never changes an existing release or app pin.
    missing.sort(key=lambda key: (key == inventory['release'], key))
    return {'release': inventory['release'], 'upload': missing, 'reuse': len(inventory['objects']) - len(missing),
            'bytes': sum(inventory['objects'][key]['bytes'] for key in missing)}


class R2Store:
    def __init__(self, endpoint, bucket, profile=None):
        if not re.fullmatch(r'https://[a-f0-9]{32}(?:\.eu|\.fedramp)?\.r2\.cloudflarestorage\.com', endpoint):
            raise ValueError('Use an explicit R2 S3 endpoint')
        import boto3
        from botocore.config import Config
        self.client = boto3.Session(profile_name=profile).client('s3', endpoint_url=endpoint, region_name='auto',
                                  config=Config(max_pool_connections=16, connect_timeout=10, read_timeout=30,
                                                retries={'mode': 'standard', 'max_attempts': 4},
                                                request_checksum_calculation='when_required', response_checksum_validation='when_required'))
        self.bucket = bucket

    def head(self, key):
        try:
            h = self.client.head_object(Bucket=self.bucket, Key=key)
        except self.client.exceptions.ClientError as error:
            if error.response['ResponseMetadata']['HTTPStatusCode'] == 404:
                return None
            raise
        result = {'bytes': h['ContentLength'], 'sha256': h.get('Metadata', {}).get('sha256'),
                  'contentType': h.get('ContentType'), 'cacheControl': h.get('CacheControl')}
        if h.get('ContentEncoding'):
            result['contentEncoding'] = h['ContentEncoding']
        return result

    def put(self, key, data, entry):
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=entry['contentType'],
                               CacheControl=entry['cacheControl'], Metadata={'sha256': entry['sha256']},
                               ContentMD5=base64.b64encode(hashlib.md5(data).digest()).decode(),
                               IfNoneMatch='*', StorageClass='STANDARD')


def publish(directory, inventory, store, workers=8, progress=None):
    if not 1 <= workers <= 16:
        raise ValueError('Use between 1 and 16 upload workers')
    stopped = Event()

    def upload(key):
        if stopped.is_set():
            return 0
        entry = inventory['objects'][key]
        existing = store.head(key)
        if existing is not None:
            if existing != entry:
                raise ValueError(f'Immutable remote metadata mismatch: {key}')
            return 0
        data = (Path(directory) / 'public' / key).read_bytes()
        if hashlib.sha256(data).hexdigest() != entry['sha256']:
            raise ValueError(f'Package changed after verification: {key}')
        try:
            store.put(key, data, entry)
        except Exception:
            stopped.set()
            raise
        if store.head(key) != entry:
            raise ValueError(f'Upload verification failed: {key}')
        return 1
    keys = iter(k for k in inventory['objects'] if k != inventory['release'])
    uploaded, completed, byte_count = 0, 0, 0
    pool = ThreadPoolExecutor(max_workers=workers)
    pending = {}
    try:
        def submit():
            key = next(keys, None)
            if key is not None:
                pending[pool.submit(upload, key)] = key
        for _ in range(workers):
            submit()
        while pending:
            done, _ = wait(pending, return_when=FIRST_COMPLETED)
            # Process every completion before dispatching more. A failing
            # batch must not enqueue the remaining 70,000 remote writes.
            for future in done:
                key = pending.pop(future)
                count = future.result()
                uploaded += count
                completed += 1
                byte_count += inventory['objects'][key]['bytes'] * count
            if progress:
                progress({'completed': completed, 'total': len(inventory['objects']),
                          'uploaded': uploaded, 'reused': completed - uploaded, 'uploadedBytes': byte_count})
            for _ in done:
                submit()
    finally:
        stopped.set()
        pool.shutdown(wait=True, cancel_futures=True)
    # An exception above leaves only reusable objects; the new manifest is absent.
    stopped.clear()
    uploaded += upload(inventory['release'])
    return {'release': inventory['release'], 'uploaded': uploaded, 'reused': len(inventory['objects']) - uploaded}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--package', type=Path, required=True)
    p.add_argument('--remote-inventory', type=Path)
    p.add_argument('--report', type=Path, required=True)
    p.add_argument('--endpoint')
    p.add_argument('--bucket')
    p.add_argument('--profile', help='Dedicated AWS SDK profile, e.g. spinward-metro; no secrets in arguments')
    p.add_argument('--workers', type=int, default=8)
    p.add_argument('--apply', action='store_true')
    args = p.parse_args()
    inventory = verify_package(args.package)
    if args.apply:
        if not args.endpoint or not args.bucket:
            p.error('--apply requires explicit --endpoint and --bucket')
        last_progress = [0.0]
        def progress(value):
            now = time.monotonic()
            if now - last_progress[0] >= 10:
                print(json.dumps({'progress': value}), flush=True)
                last_progress[0] = now
        result = publish(args.package, inventory, R2Store(args.endpoint, args.bucket, args.profile),
                         workers=args.workers, progress=progress)
    else:
        remote = json.loads(args.remote_inventory.read_bytes())['objects'] if args.remote_inventory else {}
        result = {'dryRun': True, **plan(inventory, remote)}
    args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: (len(v) if k == 'upload' else v) for k, v in result.items()}, indent=2))


if __name__ == '__main__':
    main()
