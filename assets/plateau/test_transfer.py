"""Geometry/provenance gates for generated real-data samples, not UI snapshots."""
import json
import math
import os
from pathlib import Path
import unittest
import numpy as np
from geo import Frame, cylinder, RADIUS, WIDTH
from assemble import Terrain

ROOT=Path(os.environ.get('PLATEAU_STUDY_ROOT',str(Path(__file__).resolve().parents[2]/'qa/webxr/evidence/plateau-transfer-20260922')))


class TransferTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.study=json.loads((ROOT/'derived/study.json').read_text())
        cls.imports=json.loads((ROOT/'imports.json').read_text())

    def test_three_distinct_sources_and_documented_limits(self):
        self.assertEqual([s['id'] for s in self.study['samples']],['tokyo','tama','azumino'])
        self.assertIn('unimported',self.study['status'])
        survey=json.loads((ROOT/'survey.json').read_text())
        candidates={c['id']:c for c in survey['candidates']}
        self.assertGreater(candidates['tokyo-full']['frame']['stationEnvelopeWidth'],WIDTH)
        for id_ in ('tokyo','tama','azumino'):
            self.assertTrue(candidates[id_]['frame']['fitsWith750mEachSide'])
        s=self.study['samples']
        self.assertGreater(s[0]['buildingCount'],s[1]['buildingCount']*3)
        self.assertGreater(s[1]['reliefM'][1]-s[1]['reliefM'][0],40)
        self.assertGreater(s[2]['surfaceCounts']['田'],0)
        self.assertGreater(s[2]['surfaceCounts']['畑'],0)

    def test_native_projection_and_cylinder_metric(self):
        for s in self.imports['samples']:
            f=Frame(s['frame']['epsg'],s['frame']['origin'],s['frame']['angle'])
            for lon,lat in s['corners']:
                x,y=f.place(lon,lat);np.testing.assert_allclose(f.geographic(x,y),[lon,lat],atol=1e-9,rtol=0)
            for band in range(3):
                x,y,h=512.3,-8371.7,35.6;p=np.array(cylinder(x,y,h,band))
                self.assertAlmostEqual(math.hypot(p[0],p[2]),RADIUS-h,places=9)
                self.assertEqual(p[1],y)
                # Surface arc at h=0 is exactly the source cross-band distance.
                a,b=np.array(cylinder(0,0,0,band)),np.array(cylinder(700,0,0,band))
                self.assertAlmostEqual(math.acos(np.dot(a,b)/RADIUS**2)*RADIUS,700,places=8)
                jac=np.column_stack([(np.array(cylinder(x+dx,y+dy,h+dh,band))-p)/.001 for dx,dy,dh in[(.001,0,0),(0,.001,0),(0,0,.001)]])
                self.assertGreater(np.linalg.det(jac),0,'No mirrored city')

    def test_actual_source_geometry_and_unique_buildings(self):
        total=0
        for s in self.study['samples']:
            fs=json.loads((ROOT/'derived'/s['features']).read_text())
            self.assertEqual(len(fs),s['buildingCount']);self.assertEqual(len({f['id'] for f in fs}),len(fs))
            self.assertLess(s['audit']['maxBoundsErrorM'],.5);self.assertLess(s['audit']['maxHeightRangeErrorM'],.5)
            count=0
            for f in fs:
                self.assertEqual(f['firstIndex'],count);count+=f['indexCount'];self.assertEqual(f['sourceLod'],1)
                self.assertGreater(f['bounds'][5]-f['bounds'][4],0)
            for m in s['meshes']:
                p=np.fromfile(ROOT/'derived'/m['path']/m['positions'],dtype='<f4').reshape(-1,3)
                idx=np.fromfile(ROOT/'derived'/m['path']/m['indices'],dtype='<u4')
                self.assertTrue(np.isfinite(p).all());self.assertLess(idx.max(),len(p));self.assertEqual(len(idx),m['triangles']*3)
                self.assertLessEqual(np.abs(p[:,:2]).max(),s['half']+.001)
                if m['name']=='buildings':self.assertEqual(count,len(idx))
            total+=len(fs)
        self.assertGreater(total,10000)

    def test_roads_follow_rendered_terrain_not_a_second_height_sampler(self):
        for s,i in zip(self.study['samples'],self.imports['samples']):
            f=Frame(i['frame']['epsg'],i['frame']['origin'],i['frame']['angle']);t=Terrain(ROOT,i,f)
            m=next(m for m in s['meshes'] if m['name']=='roads')
            p=np.fromfile(ROOT/'derived'/m['path']/m['positions'],dtype='<f4').reshape(-1,3)
            # Check vertices and triangle centroids independently; every overlay triangle lies in a terrain triangle.
            idx=np.fromfile(ROOT/'derived'/m['path']/m['indices'],dtype='<u4').reshape(-1,3)
            points=np.vstack([p,p[idx].mean(axis=1)])
            errors=[abs(float(z)-t.height(float(x),float(y))-.09) for x,y,z in points]
            self.assertLess(max(errors),.001)


if __name__=='__main__':unittest.main()
