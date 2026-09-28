import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from pyproj import Transformer
from shapely import from_wkb
from shapely.geometry import Polygon, box
from compile_metro_buildings import metric_features, source_footprint
from compile_metro_surfaces import connect, import_file


class BuildingMetricTests(unittest.TestCase):
    def setUp(self):
        lon,lat=139.7,35.7
        geo=np.array([[lon,lat,100],[lon+.0001,lat,100],[lon+.0001,lat+.0001,100],[lon,lat+.0001,100],
                      [lon,lat,120],[lon+.0001,lat,120],[lon+.0001,lat+.0001,120],[lon,lat+.0001,120]])
        ecef=np.column_stack(Transformer.from_crs(4979,4978,always_xy=True).transform(*geo.T))
        rtc=ecef[0].copy();a=ecef-rtc;yup=np.column_stack([a[:,0],a[:,2],-a[:,1]])
        self.data=dict(rtc=rtc.tolist(),positions=yup.flatten().tolist(),batches=[0]*8,indices=[4,5,6,4,6,7],
            features=[dict(id='building',bounds=[lon,lat,lon+.0001,lat+.0001,63,83],usage='住宅',sourceLod=1)])

    def test_orthometric_height_and_feature_identity_survive(self):
        f=next(metric_features(self.data,'13101'))
        self.assertEqual(f['source_id'],'13101:building');self.assertEqual(f['usage'],'住宅')
        self.assertAlmostEqual(f['positions'][:,2].min(),63,places=6)
        self.assertAlmostEqual(f['positions'][:,2].max(),83,places=6)
        self.assertLess(f['bounds_error'],.001);self.assertLess(f['height_error'],.001)

    def test_real_projected_walls_do_not_break_footprint_overlay(self):
        fixture=json.loads(Path(__file__).with_name('fixtures').joinpath('tokyo-metro-projected-wall.json').read_text())
        positions=np.array(fixture['positions']);indices=np.array(fixture['indices'])
        polygon=source_footprint(positions,indices)
        self.assertTrue(polygon.is_valid);self.assertAlmostEqual(polygon.area,67.51913191,delta=.01)
        # The failure previously blocked all later source tiles in the wide-area import.
        self.assertFalse(polygon.is_empty)

    def test_incorrect_source_bounds_are_rejected(self):
        self.data['features'][0]['bounds'][2]+=.001
        with self.assertRaises(AssertionError):list(metric_features(self.data,'13101'))

    def test_triangles_cannot_mix_building_ids(self):
        self.data['batches'][5]=1
        with self.assertRaises(AssertionError):list(metric_features(self.data,'13101'))


class SurfaceStoreTests(unittest.TestCase):
    def test_holes_clipping_resume_and_hash_verification(self):
        # Original square has a courtyard hole; request crop removes half its east side.
        project=Transformer.from_crs(6668,6677,always_xy=True);cx,cy=project.transform(139.7,35.7)
        inverse=Transformer.from_crs(6677,6668,always_xy=True)
        exterior=[(cx,cy),(cx+100,cy),(cx+100,cy+100),(cx,cy+100),(cx,cy)]
        hole=[(cx+25,cy+25),(cx+40,cy+25),(cx+40,cy+40),(cx+25,cy+40),(cx+25,cy+25)]
        def ring(points,tag):
            text=' '.join(f'{lat:.12f} {lon:.12f} 5' for lon,lat in [inverse.transform(*p) for p in points])
            return f'<gml:{tag}><gml:LinearRing><gml:posList>{text}</gml:posList></gml:LinearRing></gml:{tag}>'
        xml=f'''<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:luse="http://www.opengis.net/citygml/landuse/2.0"><core:cityObjectMember><luse:LandUse gml:id="parcel"><luse:class codeSpace="Common_landUseType.xml">201</luse:class><luse:lod1MultiSurface><gml:MultiSurface srsName="http://www.opengis.net/def/crs/EPSG/0/6697"><gml:surfaceMember><gml:Polygon>{ring(exterior,'exterior')}{ring(hole,'interior')}</gml:Polygon></gml:surfaceMember></gml:MultiSurface></luse:lod1MultiSurface></luse:LandUse></core:cityObjectMember></core:CityModel>'''
        with tempfile.TemporaryDirectory(prefix='spinward-metro-',dir='/tmp') as temporary:
            root=Path(temporary);(root/'source.gml').write_text(xml)
            receipt=dict(url='https://example.test/source.gml',path='source.gml',sha256=hashlib.sha256(xml.encode()).hexdigest(),kind='luse',cityCode='13101')
            db=connect(root/'source.sqlite');crop=box(cx,cy,cx+50,cy+100)
            audit=import_file(db,root,receipt,crop);self.assertEqual(audit['acceptedFeatures'],1)
            row=db.execute('SELECT class_code,geometry FROM surfaces').fetchone();shape=from_wkb(row[1])
            self.assertEqual(row[0],'201');self.assertAlmostEqual(shape.area,5000-225,places=3);self.assertEqual(len(shape.interiors),1)
            self.assertIsNone(import_file(db,root,receipt,crop));self.assertEqual(db.execute('SELECT count(*) FROM surfaces').fetchone()[0],1)
            bad={**receipt,'url':'https://example.test/altered.gml','sha256':'0'*64}
            with self.assertRaises(AssertionError):import_file(db,root,bad,crop)
            db.close()


if __name__=='__main__':unittest.main()
