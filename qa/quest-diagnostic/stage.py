"""Append the isolated diagnostic to a verified app package, preserving all app bytes."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

def stage(base, output):
    base, output = Path(base).resolve(), Path(output).resolve()
    if output.exists() or output == base or base in output.parents:
        raise ValueError('Use a fresh, separate output directory')
    inventory = json.loads((base / 'inventory.json').read_text())
    for name, entry in inventory['objects'].items():
        if hashlib.sha256((base / 'public' / name).read_bytes()).hexdigest() != entry['sha256']:
            raise ValueError(f'Base package checksum mismatch: {name}')
    root = Path(__file__).resolve().parents[2]
    source = Path(__file__).resolve().parent
    extras = {name: source / name for name in ['index.html', 'diagnostic.mjs']}
    for name in ['three.module.min.js', 'three.core.min.js']:
        extras[name] = root / 'node_modules' / 'three' / 'build' / name
    extras['VRButton.js'] = root / 'node_modules/three/examples/jsm/webxr/VRButton.js'
    extras['THREE-LICENSE.txt'] = root / 'node_modules/three/LICENSE'
    shutil.copytree(base, output)
    for name, file in extras.items():
        key = 'diagnostics/xr-entry-v1/' + name
        data = file.read_bytes()
        destination = output / 'public' / key
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        inventory['objects'][key] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    inventory['objects'] = dict(sorted(inventory['objects'].items()))
    canonical = json.dumps(inventory['objects'], sort_keys=True, separators=(',', ':')).encode()
    inventory['sha256'] = hashlib.sha256(canonical).hexdigest()
    inventory['bytes'] = sum(e['bytes'] for e in inventory['objects'].values())
    (output / 'inventory.json').write_text(json.dumps(inventory, indent=2) + '\n')
    print(json.dumps({'files': len(inventory['objects']), 'sha256': inventory['sha256']}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    stage(args.base, args.output)
