"""Full-strip coverage guards; intentionally damaged plans must fail offline."""
import copy
import math
import unittest
from plan_tokyo_metro import make_plan, verify_boundaries, building_datasets, municipal_sources
from fetch_tokyo_metro import acquisition_queue
from geo import Frame, WIDTH, SPAN


class TokyoMetroPlanTests(unittest.TestCase):
    def setUp(self):self.plan=make_plan('legacy')

    def test_all_land_area_and_stations(self):
        audit=verify_boundaries(self.plan)
        self.assertEqual(audit['cells'],1680)
        self.assertAlmostEqual(audit['areaKm2'],402.123859659,places=8)
        band=self.plan['bands'][0];f=band['frame'];frame=Frame(**dict(epsg=f['epsg'],origin=f['origin'],angle=f['angle']))
        self.assertLess(math.dist(frame.place(*self.plan['sourcePins']['tachikawa']['position']),(0,-SPAN/2)),.001)
        for key in ['kudanshita','shimbashi']:
            x,y=frame.place(*self.plan['sourcePins'][key]['position'])
            self.assertLess(abs(x),WIDTH/2);self.assertLess(abs(y),SPAN/2)
        for band in self.plan['bands']:
            self.assertFalse(any(c['acquired'] or c['rendered'] for c in band['cells']))

    def test_adjacent_edges_are_identical(self):
        bands=self.plan['bands']
        for south,north in zip(bands,bands[1:]):
            self.assertEqual(south['projectedCorners'][0],north['projectedCorners'][1])
            self.assertEqual(south['projectedCorners'][3],north['projectedCorners'][2])

    def test_adjacent_source_edges_face_across_one_window(self):
        bands=self.plan['bands']
        for south,north in zip(bands,bands[1:]):
            south_edge=south['band']*math.tau/3-WIDTH/2/self.plan['radius']
            north_edge=north['band']*math.tau/3+WIDTH/2/self.plan['radius']
            angle=(north_edge-south_edge+math.pi)%math.tau-math.pi
            self.assertAlmostEqual(abs(angle),math.pi/3)

    def test_missing_cell_is_rejected(self):
        self.plan['bands'][1]['cells'].pop(203)
        with self.assertRaises(AssertionError):verify_boundaries(self.plan)

    def test_duplicate_cell_is_rejected(self):
        cells=self.plan['bands'][2]['cells'];cells[204]=copy.deepcopy(cells[203])
        with self.assertRaises(AssertionError):verify_boundaries(self.plan)

    def test_displaced_frame_is_rejected(self):
        self.plan['bands'][2]['frame']['origin'][1]+=10
        with self.assertRaisesRegex(AssertionError,'Frame and boundary'):verify_boundaries(self.plan)

    def test_same_source_is_acquired_once_with_both_bands(self):
        for band in self.plan['bands']:
            band['cities']=[dict(cityCode='13101',buildings=[dict(url='https://example.test/shared.b3dm',contentFormat='b3dm')],files={},metadataZipUrls=[])]
        queue=acquisition_queue(self.plan);shared=[q for q in queue if q['kind']=='building']
        self.assertEqual(len(shared),1);self.assertEqual(shared[0]['bands'],['south','central','north'])
        self.assertEqual(len(queue),len(set(q['url'] for q in queue)))


class InlandPlanTests(unittest.TestCase):
    def test_designated_city_wards_use_their_buildings_and_parent_codelists(self):
        catalog=[dict(city_code='11100',ward_code=code,type_en='bldg',format='3D Tiles',lod='1') for code in ['11103','11105']]
        municipalities={code:dict(cityName=code) for code in ['11103','11105']}
        metadata={'11100':dict(cityCode='11100',files={'tran':[dict(url='https://example.test/road')]},metadataZipUrls=['https://example.test/city_codelists.zip'])}
        cities=municipal_sources(municipalities,catalog,metadata)
        self.assertEqual([c['cityCode'] for c in cities],['11103','11105'])
        self.assertTrue(all(c['surfaceCityCode']=='11100' for c in cities))
        self.assertEqual(building_datasets(catalog,'11103'),[catalog[0]])
        plan=make_plan()
        for band in plan['bands']:band['cities']=[{**c,'buildings':[]} for c in cities]
        queue=[q for q in acquisition_queue(plan) if q['kind']!='dem']
        self.assertEqual(len(queue),2)
        self.assertTrue(all(q['cityCode']=='11100' for q in queue))

    def test_accepted_b_contains_protected_places_without_resizing(self):
        plan=make_plan();audit=verify_boundaries(plan)
        self.assertAlmostEqual(audit['areaKm2'],402.123859659,places=8)
        self.assertEqual(audit['cells'],1680)
        self.assertEqual(plan['defaultRegion'],'west')
        self.assertEqual(plan['sourcePins']['imperialPalace']['band'],'east')
        for key in ['shibuya','omiya','saitamaShintoshin']:
            self.assertEqual(plan['sourcePins'][key]['band'],'west')
        self.assertGreater(plan['sourcePins']['omiya']['boundaryMarginM'],800)
        self.assertGreater(plan['sourcePins']['saitamaShintoshin']['boundaryMarginM'],1400)

    def test_increasing_cross_axis_edges_face_across_one_window(self):
        plan=make_plan()
        for a,b in zip(plan['bands'],plan['bands'][1:]):
            self.assertEqual(a['projectedCorners'][1],b['projectedCorners'][0])
            self.assertEqual(a['projectedCorners'][2],b['projectedCorners'][3])
            gap=(b['band']-a['band'])*math.tau/3-WIDTH/plan['radius']
            self.assertAlmostEqual(gap,math.pi/3)

    def test_crop_losing_palace_is_rejected(self):
        plan=make_plan();plan['protectedAreas'][1]['band']='west'
        with self.assertRaisesRegex(AssertionError,'imperial-palace'):
            verify_boundaries(plan)

if __name__=='__main__':unittest.main()
