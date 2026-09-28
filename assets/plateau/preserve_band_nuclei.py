"""Carry accepted authored details into wider cores without replacing source meshes."""
import argparse,json,shutil
from pathlib import Path


def main(source,root):
    d=root/'derived';prior=source/'derived';read=lambda p:json.loads(p.read_text())
    study=read(d/'study.json');accepted=read(prior/'study.json');report=[]
    for sample in study['samples']:
        old=next(s for s in accepted['samples'] if s['id']==sample['id'])
        w=read(d/sample['walk']);ow=read(prior/old['walk'])
        for key in ['arrival','pavements','pavementRoute','obstacles']:
            if key in ow:w[key]=ow[key]
        kept=[]
        for mesh in old['meshes']:
            if mesh['name'] in ['footways','kerbs'] or mesh['name'].startswith('park-'):
                kept.append(mesh)
                for field in ['positions','indices']:
                    shutil.copy2(prior/mesh['path']/mesh[field],d/mesh['path']/mesh[field])
        sample['meshes']=[m for m in sample['meshes'] if m['name'] not in {m['name'] for m in kept}]+kept
        if old.get('exploration'):
            sample['exploration']=old['exploration'];shutil.copy2(prior/old['exploration'],d/old['exploration'])
        (d/sample['walk']).write_text(json.dumps(w,ensure_ascii=False,separators=(',',':')))
        report.append(dict(id=sample['id'],authoredMeshes=[m['name'] for m in kept],arrival=w['arrival']))
    shutil.copy2(prior/'facade-kit.json',d/'facade-kit.json')
    (d/'study.json').write_text(json.dumps(study,ensure_ascii=False))
    (root/'preserved-nuclei.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--root',type=Path,required=True)
    a=p.parse_args();main(a.source,a.root)
