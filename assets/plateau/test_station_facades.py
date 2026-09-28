import unittest
import numpy as np
from shapely.geometry import box, LineString
from prepare_station_facades import station_match, roof_seams, attached_station_match
from plan_frontage import plan_buildings

class StationClassification(unittest.TestCase):
    def test_source_usage_and_station_alignment_both_required(self):
        footprint=box(0,0,20,100);line=LineString([(10,-10),(10,110)])
        self.assertEqual(station_match('運輸倉庫施設',footprint,7,line)['kind'],'platform')
        self.assertIsNone(station_match('業務施設',footprint,7,line))
        self.assertIsNone(station_match('不明',footprint,7,line))
        self.assertIsNone(station_match('運輸倉庫施設',box(30,0,50,100),7,line))
        self.assertIsNone(station_match('運輸倉庫施設',box(0,0,5,5),7,line))
        self.assertEqual(station_match('運輸倉庫施設',box(0,0,100,200),35,line)['kind'],'hall')

    def test_attached_transport_hall_needs_shared_boundary_not_proximity(self):
        anchor=box(0,0,100,200)
        self.assertEqual(attached_station_match('運輸倉庫施設',box(-30,0,0,100),20,anchor)['kind'],'hall')
        self.assertIsNone(attached_station_match('商業施設',box(-30,0,0,100),20,anchor))
        self.assertIsNone(attached_station_match('運輸倉庫施設',box(-30,0,-2,100),20,anchor))
        self.assertIsNone(attached_station_match('運輸倉庫施設',box(-30,199,0,220),20,anchor))

    def test_roof_seams_stay_inside_source_and_never_flatten_sloped_roof(self):
        p=np.array([[0,0,12],[20,0,12],[20,100,12],[0,100,12]],dtype=float)
        seams=roof_seams(p,np.array([0,1,2,0,2,3]))
        self.assertTrue(seams)
        for s in seams:self.assertTrue(box(.17,.17,19.83,99.83).covers(LineString([s['a'],s['b']])))
        p[2:,2]=14
        self.assertEqual(roof_seams(p,np.array([0,1,2,0,2,3])),[])

    def test_centimetre_source_height_drift_does_not_cut_diagonal_holes_in_roof(self):
        p=np.array([[0,0,12],[20,0,12.01],[20,100,12.026],[0,100,12.016]],dtype=float)
        seams=roof_seams(p,np.array([0,1,2,0,2,3]))
        self.assertTrue(seams)
        for s in seams:self.assertGreater(LineString([s['a'],s['b']]).length,99)

    def test_low_attached_building_only_masks_lower_station_elevation(self):
        class Terrain:
            def height(self,x,y):return 0
        station=dict(id='station',rings=[list(box(0,0,20,20).exterior.coords)],base=0,top=30)
        neighbour=dict(id='next',rings=[list(box(0,-10,20,0).exterior.coords)],base=0,top=12)
        p=np.array([[x,y,z] for z in [0,30] for x,y in [(0,0),(20,0),(20,20),(0,20)]])
        idx=np.array([[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]])
        features={'station':dict(usage='運輸倉庫施設',firstIndex=0,indexCount=idx.size)}
        w=dict(buildings=[station,neighbour],roads=[])
        result=plan_buildings(w,features,p,idx,Terrain(),station_ids={'station'})
        south=next(w for w in result[0]['walls'] if w['normal'][1]<-.99)
        self.assertAlmostEqual(south['base'],12.2);self.assertEqual(south['top'],30)
        neighbour['top']=30
        result=plan_buildings(w,features,p,idx,Terrain(),station_ids={'station'})
        self.assertFalse(any(w['normal'][1]<-.99 for w in result[0]['walls']))

if __name__=='__main__':unittest.main()
