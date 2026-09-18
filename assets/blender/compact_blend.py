"""Losslessly recompress a Blender Zstandard source into a separate output.

Requires the zstd CLI. Usage: python3 compact_blend.py source.blend output.blend
The source is never replaced here. Verify the output in Blender before adopting
it; this utility proves decompressed byte identity, not editor compatibility.
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys


def decompressed_digest(zstd, path):
    process = subprocess.Popen([zstd, '-dc', str(path)], stdout=subprocess.PIPE)
    digest = hashlib.sha256()
    size = 0
    with process.stdout:
        while data := process.stdout.read(1024 * 1024):
            digest.update(data)
            size += len(data)
    if process.wait():
        raise RuntimeError('Cannot decompress ' + str(path))
    return size, digest.hexdigest()


def compact(source, target):
    zstd = shutil.which('zstd')
    if not zstd:
        raise RuntimeError('Install the zstd CLI before compacting native sources')
    source, target = Path(source), Path(target)
    if source.resolve() == target.resolve():
        raise ValueError('Use a separate output; the source must remain available')
    with source.open('rb') as stream:
        if stream.read(4) != bytes.fromhex('28b52ffd'):
            raise ValueError('Expected a Blender Zstandard-compressed source')
    with target.open('xb') as output:
        decode = subprocess.Popen([zstd, '-dc', str(source)], stdout=subprocess.PIPE)
        encode = subprocess.run([zstd, '-19', '-T2', '-c'], stdin=decode.stdout, stdout=output)
        decode.stdout.close()
        if decode.wait() or encode.returncode:
            raise RuntimeError('Recompression failed; source was retained')
    original = decompressed_digest(zstd, source)
    if decompressed_digest(zstd, target) != original:
        raise RuntimeError('Recompressed bytes differ; source was retained')
    return {'sourceBytes': source.stat().st_size, 'outputBytes': target.stat().st_size,
            'uncompressedBytes': original[0], 'uncompressedSha256': original[1]}


if __name__ == '__main__':
    print(json.dumps(compact(*sys.argv[1:]), indent=2))
