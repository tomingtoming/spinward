import unittest
import numpy as np
from shapely.geometry import box,LineString
from shapely import contains_xy
from source_route_grid import edges_for,astar


class RoadEdges(unittest.TestCase):
    def test_thin_obstacle_between_clear_samples_cannot_be_crossed(self):
        domain=box(-1,-1,5,5).difference(box(.9,-.4,1.1,3.4))
        axis=np.arange(0,5,2);x,y=np.meshgrid(axis,axis);mask=contains_xy(domain,x,y)
        self.assertTrue(mask.all(),'Every sampled point is clear; endpoint tests alone would miss the wall')
        edges=edges_for(domain,mask,axis,axis);path=astar(edges,(0,0),(1,0),2)
        points=[(axis[x],axis[y]) for x,y in path]
        self.assertGreater(len(points),3)
        self.assertTrue(domain.covers(LineString(points)))
        self.assertFalse(int(edges[0,0])&1,'The direct clear-endpoint edge crosses the wall')


if __name__=='__main__':unittest.main()
