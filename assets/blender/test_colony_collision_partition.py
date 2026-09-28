import copy
from collections import Counter
import unittest

from colony_collision_partition import refine_city_ground


class DenseGroundTest(unittest.TestCase):
    def test_local_compounds_preserve_every_face_support_flag_and_input(self):
        vertices=[];surfaces=[];ids=[]
        for column in range(4):
            start=len(vertices)//3
            for i in range(270):
                x=column*32+(i%10)*.5;y=(i//10)*.5
                vertices.extend([x,y,2,x+.25,y,2,x,y+.25,2])
            indices=list(range(start,len(vertices)//3));ids.extend(indices)
        surfaces.append({'indices':list(ids),'bounds':[0,0,100.75,13.25]})
        # Small independent surfaces at one address can share a body, while
        # the non-ground support flag must remain separate.
        surfaces.extend([{'indices':ids[:3],'bounds':[0,0,.25,.25]},
                         {'indices':ids[3:6],'bounds':[.5,0,.75,.25]},
                         {'indices':ids[6:9],'bounds':[1,0,1.25,.25],'groundSurface':False}])
        source={'vertices':vertices,'meshes':{'walk':ids},'surfaces':surfaces}
        before=copy.deepcopy(source)
        def triangles(packed):
            return Counter((s.get('groundSurface',True),*s['indices'][i:i+3])
                           for s in packed['surfaces'] for i in range(0,len(s['indices']),3))
        result=refine_city_ground(source)
        self.assertEqual(triangles(result),triangles(source))
        self.assertEqual(result['vertices'],source['vertices'])
        self.assertEqual(result['meshes'],source['meshes'])
        self.assertEqual(source,before)
        self.assertEqual(refine_city_ground(result),result)
        self.assertEqual(len(result['surfaces']),6)
        for s in result['surfaces']:
            for i in s['indices']:
                x,y=vertices[i*3:i*3+2]
                self.assertLessEqual(s['bounds'][0],x);self.assertGreaterEqual(s['bounds'][2],x)
                self.assertLessEqual(s['bounds'][1],y);self.assertGreaterEqual(s['bounds'][3],y)


if __name__=='__main__':unittest.main()
