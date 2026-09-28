"""Room use, visible apertures and unchanged physical building surfaces."""
import unittest
from collections import Counter

from izma_building_identity import building_identity
from izma_building_forms import building_form
from izma_building_meshes import render_building
from izma_facades import facade, window_rows
from izma_mesh_builder import BuildingMeshBuilder
from test_izma_facades import Mesh


def parcel(kind,n):
    w,d=18,14;floors=4;fh=3.4 if kind=='office' else 3.2
    form,volumes,_=building_form(kind,w,d,floors,fh,n,True)
    return {'id':f'identity-{kind}-{n}','district':'a-old-town','family':kind,'size':[w,d,fh*floors],
            'floors':floors,'floor':2,'foundationBottom':0,'wall':'wall-grey','roof':'roof-slate',
            'groundShop':kind=='shop-house','form':form,'volumes':volumes}


class IdentityTest(unittest.TestCase):
    def test_balcony_partitions_and_side_guards_do_not_cut_door_openings(self):
        class Recorder(BuildingMeshBuilder):
            def __init__(self):
                super().__init__(None, None); self.partitions=[]
            def box(self,x,y,z,w,d,h,mat,*args,**kwargs):
                if w==.07 and d==1.48 and h==1.45:self.partitions.append((x,z))
                super().box(x,y,z,w,d,h,mat,*args,**kwargs)
        for span in [9,18,29]:
            for n in range(12):
                p=parcel('apartment',n);identity=building_identity(p);mesh=Recorder()
                facade(mesh,0,0,0,span,14,4,'apartment',n,0,'wall-grey',True,False,identity)
                rows=window_rows(span,4,'apartment',n,0,True,False,identity=identity)
                for row,openings in enumerate(rows[1:],1):
                    for o in openings:
                        self.assertGreaterEqual(o['left'],-span*.46+.05)
                        self.assertLessEqual(o['right'],span*.46-.05)
                        for x,z in mesh.partitions:
                            if abs(z-row*3.2)>.01:continue
                            self.assertTrue(x+.035<=o['left'] or x-.035>=o['right'],
                                            (span,n,row,x,o))
                    self.assertEqual(sum(abs(z-row*3.2)<.01 for _,z in mesh.partitions),len(openings)-1)

    def test_different_sill_heights_leave_openings_visible_in_both_lods(self):
        for kind in ['house','shop-house','apartment','office','workshop']:
            for n in [3,33,118,261]:
                p=parcel(kind,n);identity=building_identity(p)
                meshes=[Mesh(),Mesh()]
                for lod,mesh in enumerate(meshes):
                    facade(mesh,0,0,0,18,14,4,kind,n,lod,'wall-grey',kind=='apartment',p['groundShop'],identity)
                rows=window_rows(18,4,kind,n,0,kind=='apartment',p['groundShop'],identity=identity)
                for o in [o for row in rows for o in row]:
                    x=o['left']*.7+o['right']*.3;z=(o['bottom']+o['top'])/2
                    for mesh in meshes:self.assertEqual(mesh.front_hit(x,z)[1],o['pane'],(kind,n,o))
                self.assertEqual(meshes[0].front_hit(-8.9,.05),(-7,'wall-grey'))

    def test_waist_windows_room_colour_and_door_lamp_pier(self):
        colours=set();styles=set()
        for n in range(36):
            for kind in ['house','apartment','shop-house','office']:
                p=parcel(kind,n);identity=building_identity(p);styles.add(identity['style'])
                for base in [0,3.4 if kind=='office' else 3.2]:
                    for side in range(4):
                        rows=window_rows(9,3,kind,n,side,kind=='apartment',p['groundShop'],base,identity)
                        for row,openings in enumerate(rows):
                            for o in openings:
                                self.assertGreater(o['left'],-4.5);self.assertLess(o['right'],4.5)
                                self.assertGreaterEqual(o['right']-o['left'],.28)
                                fh=3.4 if kind=='office' else 3.2
                                self.assertGreaterEqual(o['bottom'],row*fh)
                                self.assertLess(o['top'],(row+1)*fh)
                                if kind=='office':self.assertIn(o['pane'],['glass','window-cool'])
                                elif o['pane']!='glass':colours.add(o['pane'])
                                if kind!='office' and (row>0 or base>0) and not o['balcony']:
                                    self.assertGreaterEqual(o['bottom']-row*3.2,1)
                                    self.assertLessEqual(o['top']-o['bottom'],1.4)
                                if side==0 and row==0 and base==0:
                                    half=1.4 if kind=='office' else .95 if kind=='apartment' else .55
                                    self.assertTrue(o['right']<=-half-.55 or o['left']>=half+.55)
        self.assertEqual(colours,{'window-warm','window-neutral','window-cool'})
        self.assertGreaterEqual(len(styles),10)

    def test_identity_does_not_change_roof_balcony_or_apron_support(self):
        class Recorder(BuildingMeshBuilder):
            def finish(self,name,p,lod):
                faces=Counter()
                for face,flag in zip(self.f,self.g):
                    if not flag:continue
                    points=tuple(tuple(self.v[i])for i in face)
                    faces[min(points[i:]+points[:i]for i in range(len(points)))]+=1
                collected[lod]=faces
        for kind in ['house','shop-house','apartment','office','workshop','civic']:
            for n in [3,33,118,261]:
                p=parcel(kind,n);before=None
                for revised in [False,True]:
                    collected={}
                    render_building(lambda:Recorder(None,None),p,n,{'variedMassing':True,'buildingIdentity':revised})
                    if before is None:before=collected
                    else:self.assertEqual(before,collected,(kind,n))


if __name__=='__main__':unittest.main()
