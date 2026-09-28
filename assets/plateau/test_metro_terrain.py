import math
import unittest
import numpy as np
from compile_metro_terrain import DemSampler


class ArraySampler(DemSampler):
    def __init__(self,tiles):self.tiles=tiles
    def tile(self,key):return self.tiles.get(key)


def geographic_pixel(x,y):
    return x/(16384*256)*360-180,math.degrees(math.atan(math.sinh(math.pi*(1-2*y/(16384*256)))))


class TerrainTests(unittest.TestCase):
    def test_pixel_centres_bilinear_and_fallback(self):
        x,y=np.meshgrid(np.arange(256),np.arange(256));high=10+x*.1+y*.2;low=high-4
        sampler=ArraySampler({('dem5a',14550,6450):high,('dem',14550,6450):low})
        lon,lat=geographic_pixel(14550*256+128.75,6450*256+120.25)
        z,source=sampler.sample([lon],[lat]);self.assertAlmostEqual(z[0],10+128.25*.1+119.75*.2,places=7);self.assertEqual(source[0],1)
        high[119,128]=np.nan
        z,source=sampler.sample([lon],[lat]);self.assertAlmostEqual(z[0],6+128.25*.1+119.75*.2,places=7);self.assertEqual(source[0],2)
        low[119,128]=np.nan
        z,source=sampler.sample([lon],[lat]);self.assertTrue(np.isnan(z[0]));self.assertEqual(source[0],0)

    def test_interpolation_requires_neighbour_tile(self):
        lon,lat=geographic_pixel(14550*256+256.25,6450*256+100.5)
        left=np.full((256,256),10.);right=np.full((256,256),20.)
        sampler=ArraySampler({('dem5a',14550,6450):left})
        z,source=sampler.sample([lon],[lat]);self.assertTrue(np.isnan(z[0]))
        sampler.tiles[('dem5a',14551,6450)]=right
        z,source=sampler.sample([lon],[lat]);self.assertAlmostEqual(z[0],17.5,places=7)


if __name__=='__main__':unittest.main()
