import json
import unittest
from pathlib import Path
import numpy as np
from assemble import Terrain,Frame

ROOT=Path(__file__).resolve().parents[2]/'qa/webxr/evidence/plateau-transfer-20260922'


class ContactTests(unittest.TestCase):
    def test_foundation_mesh_touches_source_base_and_buries_below_ground(self):
        report=json.loads((ROOT/'derived/study.json').read_text());imports=json.loads((ROOT/'imports.json').read_text())
        for s,imp in zip(report['samples'],imports['samples']):
            t=Terrain(ROOT,imp,Frame(imp['frame']['epsg'],imp['frame']['origin'],imp['frame']['angle']))
            m=next(m for m in s['meshes'] if m['name']=='foundations')
            p=np.fromfile(ROOT/'derived'/m['path']/m['positions'],dtype='<f4').reshape(-1,4,3)
            self.assertGreater(len(p),0)
            np.testing.assert_allclose(p[:,0,2],p[:,1,2],atol=1e-5)
            np.testing.assert_allclose(p[:,0,:2],p[:,3,:2],atol=1e-5)
            np.testing.assert_allclose(p[:,1,:2],p[:,2,:2],atol=1e-5)
            self.assertTrue((p[:,0,2]>p[:,3,2]).all());self.assertTrue((p[:,1,2]>p[:,2,2]).all())
            for quad in p:
                for x,y,z in quad[2:]:self.assertLessEqual(z,t.height(x,y)-.119)
            data=json.loads((ROOT/'derived'/s['walk']).read_text())
            self.assertGreater(data['audit']['buildingsWithAddedSkirt'],0)
            self.assertGreater(data['arrival']['length'],65)
            self.assertEqual(len(data['heights']),len(data['axis']))


if __name__=='__main__':unittest.main()
