import json,math,unittest
from pathlib import Path
from izma_block_parcels import block_boundary,partition,intersection_area,faces_close_neighbour
from izma_ground_patches import area
from plan_izma_urban import corridor,project


class CompleteBlockTest(unittest.TestCase):
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
