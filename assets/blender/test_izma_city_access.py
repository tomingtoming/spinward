import copy,math,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from izma_city_access import raised_footway_entry,entry_sections,append_entry


class Walk:
    def __init__(self,length,height):self.length=length;self.height=height
    def split(self,polygon):
        end=min(self.length,max(p[0]for p in polygon))
        yield [(0,-.8,self.height),(end,-.8,self.height),(end,.8,self.height),(0,.8,self.height)]


def parcel(length,bottom):
    return {'id':'entrance','position':[length,0],'yaw':0,'floor':bottom,'foundationBottom':bottom-.5,
            'entrance':{'start':[0,0,15],'end':[length,0,bottom],'width':1.6,'ramp':False,'steps':15}}


class CityAccessTest(unittest.TestCase):
    def test_descending_stairs_begin_after_the_public_footway(self):
        before=parcel(7.8,12.8);original=copy.deepcopy(before)
        p=raised_footway_entry(before,Walk(1.9,15.1))
        self.assertEqual(before,original);self.assertEqual(p['floor'],before['floor'])
        e=p['entrance'];self.assertGreater(e['landingLength'],1.9)
        self.assertGreaterEqual((7.8-e['landingLength'])/e['steps'],.28)
        sections=list(entry_sections(p))
        self.assertEqual(sections[0][2:],(15.115,15.115))
        for lo,hi,start,end in sections[1:]:self.assertGreaterEqual(lo*7.8,1.9)
        self.assertAlmostEqual(sections[-1][3],p['floor'])

    def test_short_approach_raises_threshold_and_retains_foundation_bottom(self):
        before=parcel(2.2,14);p=raised_footway_entry(before,Walk(1.9,15.1))
        self.assertEqual(p['foundationBottom'],before['foundationBottom'])
        self.assertAlmostEqual(p['floor'],15.115)
        self.assertTrue(p['entrance']['ramp'])
        self.assertGreater(p['accessClearance']['floorRaise'],1)
        faces=[]
        class Builder:
            def face(self,points,material,physical):faces.append((points,physical))
        append_entry(Builder(),p)
        self.assertTrue(faces)
        for face,physical in faces:
            self.assertTrue(physical)
            for x,y,z in face:self.assertAlmostEqual(z,0)

    def test_original_entrances_keep_their_tread_heights(self):
        p=parcel(7.8,12.8);e=p['entrance']
        for i,(lo,hi,start,end)in enumerate(entry_sections(p)):
            self.assertEqual(lo,i/e['steps']);self.assertEqual(hi,(i+1)/e['steps'])
            self.assertEqual(start,end)
            self.assertAlmostEqual(end,15+(12.8-15)*(i+1)/e['steps'])


if __name__=='__main__':unittest.main()
