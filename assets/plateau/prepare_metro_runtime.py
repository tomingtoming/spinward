"""Package shared existing assets; never regenerate an individual building."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path
from plan_tokyo_metro import write


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True);args=parser.parse_args()
    root=args.root.resolve();repo=Path(__file__).resolve().parents[2];output=root/'derived'
    sources=[(repo/'public/assets/people/resident.glb','assets/people/resident.glb'),
             (repo/'qa/webxr/evidence/plateau-bands-20260923/derived/facade-kit.json','facade-kit.json')]
    receipts=[]
    for source,name in sources:
        assert source.is_file(),str(source)
        dest=output/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,dest)
        receipts.append(dict(source=str(source.relative_to(repo)),path=name,sha256=hashlib.sha256(dest.read_bytes()).hexdigest(),bytes=dest.stat().st_size))
    write(root/'runtime-shared-assets.json',dict(origin='ai',created='2026-09-24',assets=receipts))
    print(json.dumps(receipts),flush=True)


if __name__=='__main__':main()
