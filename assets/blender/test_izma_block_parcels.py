import json,math,unittest
from pathlib import Path
from izma_block_parcels import block_boundary,partition,intersection_area,faces_close_neighbour,trim_unusable_rear,fit_front_rectangle
from izma_ground_patches import area
from plan_izma_urban import corridor,project


class CompleteBlockTest(unittest.TestCase):
    def test_a_rectangular_wing_fits_the_irregular_lot_and_retains_street_access(self):
        lot=[(0,0),(18,0),(11,15),(6,15)]
        rectangle=fit_front_rectangle(lot,lot[:2],6)
        self.assertEqual(len(rectangle),4)
        self.assertAlmostEqual(intersection_area(rectangle,lot),abs(area(rectangle)),places=6)
        self.assertGreater(abs(area(rectangle)),60)
        street_front=[p for p in rectangle if abs(p[1])<1e-6]
        self.assertEqual(len(street_front),2)
        self.assertGreaterEqual(math.dist(*street_front),6)
        for i,p in enumerate(rectangle):
            a,b=rectangle[i-1],rectangle[(i+1)%4]
            self.assertAlmostEqual(sum((a[k]-p[k])*(b[k]-p[k]) for k in range(2)),0,places=6)

    def test_a_tapered_tail_cannot_be_extruded_as_a_room(self):
        front=[(0,0),(8,0)]
        needle=[*front,(4.1,14),(4,14)]
        result=trim_unusable_rear(needle,front,4)
        depth=max(p[1] for p in result)
        rear=[p[0] for p in result if abs(p[1]-depth)<1e-6]
        self.assertGreaterEqual(max(rear)-min(rear),4-1e-6)
        self.assertLess(depth,8)
        self.assertTrue(all(p in result for p in front))
        rectangle=[*front,(8,14),(0,14)]
        self.assertAlmostEqual(abs(area(trim_unusable_rear(rectangle,front,4))),112)
        self.assertEqual(trim_unusable_rear([(0,0),(3,0),(3,12),(0,12)],[(0,0),(3,0)],4),[])

    def test_court_walls_keep_openings_while_close_party_walls_are_screened(self):
        a,b=(0,0),(10,0)
        close=[(0,-1),(0,-5),(10,-5),(10,-1)]
        behind=[(0,1),(10,1),(10,5),(0,5)]
        partial=[(0,-1),(0,-5),(3,-5),(3,-1)]
        self.assertTrue(faces_close_neighbour(a,b,[close]))
        self.assertFalse(faces_close_neighbour(a,b,[behind]))
        self.assertFalse(faces_close_neighbour(a,b,[partial]))
        self.assertFalse(faces_close_neighbour(a,b,[[(x,y-3) for x,y in close]]))

    @classmethod
    def setUpClass(cls):
        root=Path(__file__).parent
        cls.specs=json.loads((root/'izma-block-layouts.json').read_text())['blocks']
        cls.streets={s['id']:s for s in json.loads((root/'izma-neighbourhood-parcels.json').read_text())['streets']}

    def test_saved_block_roads_remain_clear_and_plots_do_not_overlap(self):
        for spec in self.specs:
            polygon,widths=block_boundary(self.streets[spec['outerStreet']],self.streets[spec['returnStreet']])
            result=partition(polygon,widths,spec);plots=result['plots']
            self.assertGreater(len(plots),7)
            for i,p in enumerate(plots):
                for q in plots[i+1:]:self.assertLess(intersection_area(p['outline'],q['outline']),.0001)
                for a,b,w in zip(polygon,polygon[1:]+polygon[:1],widths):
                    # Every adjoining street keeps its footway, including the
                    # return street beside a plot facing a different edge.
                    self.assertLess(intersection_area(p['outline'],corridor(a,b,w+2*spec['setback'])),.0001,(spec['id'],i))
            whole=sum(abs(area(p)) for p in result['sectors'])
            occupied=sum(p['area'] for p in plots)
            free=sum(abs(area(p)) for p in result['courtPieces'])
            self.assertAlmostEqual(whole,occupied+free,places=3)
            self.assertGreater(free,whole*.25)

    def test_each_court_has_two_full_width_passages(self):
        for spec in self.specs:
            polygon,widths=block_boundary(self.streets[spec['outerStreet']],self.streets[spec['returnStreet']])
            result=partition(polygon,widths,spec)
            self.assertEqual(len(result['gates']),2)
            for g in result['gates']:
                for a,b in [(g['start'],g['end']),(g['end'],result['centre'])]:
                    route=corridor(a,b,g['width']-.1)
                    for p in result['plots']:
                        self.assertLess(intersection_area(route,p['outline']),.0001,(spec['id'],g['edge']))


if __name__=='__main__':unittest.main()
