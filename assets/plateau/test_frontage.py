"""Protect source geometry and the newly walkable raised surface."""
import json,unittest
from pathlib import Path
import numpy as np
from shapely.geometry import Polygon,LineString
from shapely import union_all
from assemble import Terrain,Frame
from prepare_walk import read_mesh

ROOT=Path(__file__).resolve().parents[2]/'qa/webxr/evidence/plateau-transfer-20260922'

def triangles_sorted(p,i):
    # Vertex/triangle order is irrelevant, coordinates are exact float32 source values.
    return sorted(tuple(sorted(tuple(v) for v in p[t])) for t in i)

class FrontageTests(unittest.TestCase):
    def setUp(self):
        self.study=json.loads((ROOT/'derived/study.json').read_text());self.s=self.study['samples'][0]
        self.w=json.loads((ROOT/'derived/tokyo/walk.json').read_text())
        self.front=json.loads((ROOT/'derived/tokyo/frontage.json').read_text())

    def test_authored_bodies_keep_every_source_triangle_exactly_once(self):
        p,i=read_mesh(ROOT,self.s,'buildings');wanted=set(self.front['buildingIds'])
        fs=json.loads((ROOT/'derived/tokyo/features.json').read_text())
        selected=np.concatenate([i[f['firstIndex']//3:(f['firstIndex']+f['indexCount'])//3] for f in fs if f['id'] in wanted])
        expected=triangles_sorted(p,selected);actual=[]
        for m in self.front['meshes']:
            if m['name'].startswith(('frontage-plaster','frontage-brick','frontage-cladding')):
                pp,ii=read_mesh(ROOT,self.s,m['name']);actual.extend(triangles_sorted(pp,ii))
        self.assertEqual(expected,sorted(actual));self.assertEqual(len(wanted),22)

    def test_footway_has_body_clearance_and_drawn_ground_contact(self):
        paving=union_all([Polygon(a['rings'][0],a['rings'][1:]) for a in self.w['pavements']])
        roads=union_all([Polygon(a['rings'][0],a['rings'][1:]) for a in self.w['roads']])
        buildings=union_all([Polygon(a['rings'][0],a['rings'][1:]) for a in self.w['buildings']])
        route=LineString(self.w['pavementRoute'])
        self.assertGreater(route.length,14);self.assertTrue(paving.buffer(-.35).covers(route))
        self.assertGreater(route.distance(buildings),.39)
        self.assertLess(paving.difference(roads).area,.001)
        imp=json.loads((ROOT/'imports.json').read_text())['samples'][0];f=imp['frame'];t=Terrain(ROOT,imp,Frame(f['epsg'],f['origin'],f['angle']))
        p,i=read_mesh(ROOT,self.s,'footways')
        for x,y,z in np.vstack([p,p[i].mean(axis=1)]):self.assertLess(abs(z-t.height(x,y)-.20),.001)

    def test_refined_hill_ground_is_raw_dem_not_building_translation(self):
        s=self.study['samples'][1];w=json.loads((ROOT/'derived'/s['walk']).read_text())
        self.assertEqual(w['step'],5)
        negatives={a['id'] for a in w['audit']['roofConcerns'] if a['roofAboveHighestGrade']<0}
        self.assertEqual(len(negatives),12,'Unresolved conflicts must remain visible, not silently flattened')

if __name__=='__main__':unittest.main()
