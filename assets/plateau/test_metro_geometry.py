import json
import math
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image
from shapely.geometry import Polygon, box

from metro_geometry import Frame, Grid, clip_mesh, pack, prism, terrain_mesh
from prepare_metro_overview import owner, paint, tile_grid, tile_specs


class MetroGeometryTests(unittest.TestCase):
    def test_actual_strip_tile_coverage_and_owner_agree_at_every_cell(self):
        from shapely import union_all
        band=dict(bounds=[-math.pi*3200/6,-20000,math.pi*3200/6,20000])
        specs=list(tile_specs(band));origin,grid=tile_grid(band)
        self.assertEqual(grid,[17,200]);self.assertEqual(origin,[-1700,-20000])
        self.assertEqual(len(specs),3400)
        areas=[box(*s['bounds']) for s in specs]
        self.assertLess(union_all(areas).symmetric_difference(box(*band['bounds'])).area,.001)
        self.assertAlmostEqual(sum(p.area for p in areas),box(*band['bounds']).area,places=3)
        for spec in specs:
            x0,y0,x1,y1=spec['bounds']
            self.assertEqual(owner(band,box(x0+.01,y0+.01,x1-.01,y1-.01)),spec['id'])

    def test_local_frame_retains_native_south_and_east(self):
        angle=-.06;c,s=np.cos(angle),np.sin(angle)
        frame=Frame(dict(frame=dict(origin=[1000,2000],angle=angle)))
        source=np.array([[1000+5*s+17*c,2000-5*c+17*s,12]])
        np.testing.assert_allclose(frame.points(source),[[5,17,12]])
        p=frame.shape(box(1000,2000,1010,2010))
        self.assertAlmostEqual(p.area,100)

    def test_courtyard_is_preserved_in_volumes_and_raster(self):
        shape=Polygon(box(0,0,20,20).exterior.coords,[box(5,5,15,15).exterior.coords])
        p,i=prism(shape,0,10)
        faces=p[i.reshape(-1,3)]
        roofs=faces[np.all(faces[:,:,2]==10,axis=1)]
        self.assertAlmostEqual(sum(Polygon(t[:,:2]).area for t in roofs),300)
        image=Image.new('RGB',(20,20),'blue');paint(image,shape,'red',[0,0,20,20],1)
        self.assertEqual(image.getpixel((10,10)),(0,0,255))
        self.assertEqual(image.getpixel((2,2)),(255,0,0))

    def test_clipped_building_has_closed_cross_section(self):
        p,i=prism(box(-2,-3,2,3),0,10)
        # Add the otherwise intentionally omitted ground-facing bottom.
        q,j=prism(box(-2,-3,2,3),0,0)
        roof=j.reshape(-1,3)[:2][:,::-1]+len(p)
        positions=np.concatenate([p,q]);indices=np.r_[i,roof.reshape(-1)]
        p,i=clip_mesh(positions,indices,[0,-3,2,3])
        self.assertGreaterEqual(float(p[:,0].min()),0)
        faces=p[i.reshape(-1,3)]
        caps=faces[np.all(faces[:,:,0]==0,axis=1)]
        self.assertAlmostEqual(sum(Polygon(t[:,1:]).area for t in caps),60)
        np.testing.assert_array_less(np.cross(caps[:,1]-caps[:,0],caps[:,2]-caps[:,0])[:,0],1e-7)

    def test_every_lod_has_same_shared_tile_edge_and_normal(self):
        with tempfile.TemporaryDirectory(prefix='spinward-metro-',dir='/tmp') as temp:
            root=Path(temp);(root/'terrain').mkdir()
            xs=np.arange(-205,410,5);ys=np.arange(-5,210,5);x,y=np.meshgrid(xs,ys)
            z=(7*np.sin(x/21)*np.cos(y/31)).astype('<f4');z.tofile(root/'terrain/test.bin')
            (root/'terrain/test.json').write_text(json.dumps(dict(ready=True,sampleCounts=dict(missing=0),step=5,origin=[-205,-5],grid=[len(xs),len(ys)],heights='terrain/test.bin')))
            grid=Grid(root,'test')
            near=terrain_mesh(grid,[0,0,200,200],5)
            far=terrain_mesh(grid,[200,0,400,200],40)
            a=near['position'][:,0]==200;b=far['position'][:,0]==200
            order=lambda p,n:(p[np.argsort(p[:,1])],n[np.argsort(p[:,1])])
            p,n=order(near['position'][a],near['normal'][a]);q,m=order(far['position'][b],far['normal'][b])
            np.testing.assert_array_equal(p,q);np.testing.assert_array_equal(n,m)
            self.assertEqual(len(q),41)
            self.assertLess(len(far['index']),len(near['index'])/5)
            for mesh in [near,far]:
                faces=mesh['position'][mesh['index'].reshape(-1,3)]
                self.assertTrue(np.all(np.cross(faces[:,1]-faces[:,0],faces[:,2]-faces[:,0])[:,2]>0))

    def test_binary_header_offsets_and_component_types(self):
        p=np.array([[1,2,3],[4,5,6],[7,8,9]],dtype='<f4');i=np.array([0,1,2],dtype='<u4')
        data=pack([dict(name='building',attributes=dict(position=p,index=i))])
        size=int.from_bytes(data[:4],'little');header=json.loads(data[4:4+size]);start=4+(size+3)//4*4
        a=header['meshes'][0]['attributes'];self.assertEqual(a['index']['type'],'u32')
        np.testing.assert_array_equal(np.frombuffer(data,dtype='<u4',count=3,offset=start+a['index']['offset']),i)


if __name__=='__main__':unittest.main()
