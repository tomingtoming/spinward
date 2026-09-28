"""Offline placement constraints from the actual saved earth and road levels."""
import math
from izma_ground_patches import GroundPatches, area


class CityGround:
    def __init__(self, base, neighbourhood, transport):
        self.terrain = GroundPatches(base)
        self.profiles = {s['id']: s['profile'] for s in neighbourhood['streets']}
        for p in transport['profiles']:
            shift = p['band'] * math.tau * 3200 / 3
            self.profiles[p['id']] = [[q[0] + shift, q[1], q[2]] for q in p['points']]
        self.cache = {}

    def range(self, polygon):
        polygon = list(polygon)
        if area(polygon) < 0:
            polygon.reverse()
        pieces = list(self.terrain.split(polygon))
        covered = sum(abs(area(p)) for p in pieces)
        if abs(covered - abs(area(polygon))) > max(.01, abs(area(polygon)) * 1e-5) or not pieces:
            raise ValueError(('Incomplete native terrain', polygon, covered))
        heights = [p[2] for piece in pieces for p in piece]
        return min(heights), max(heights)

    def ground(self, p):
        key = tuple(p)
        if key not in self.cache:
            x, y = p
            self.cache[key] = self.range([[x-.005,y-.005],[x+.005,y-.005],
                                         [x+.005,y+.005],[x-.005,y+.005]])[1]
        return self.cache[key]

    def road(self, p, name):
        profile = self.profiles[name]
        best = (math.inf, 0)
        for a, b in zip(profile, profile[1:]):
            dx, dy = b[0] - a[0], b[1] - a[1]
            length2 = dx * dx + dy * dy
            if not length2:
                continue
            t = max(0, min(1, ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / length2))
            distance = (p[0]-a[0]-dx*t)**2 + (p[1]-a[1]-dy*t)**2
            best = min(best, (distance, a[2]+(b[2]-a[2])*t))
        assert best[0] < math.inf, ('Empty road profile', name)
        return max(self.ground(p)+.045, best[1]+.035)

    def passage_height(self, p, gates):
        correction = 0
        for g in gates:
            a, b = g['start'], g['end']
            dx, dy = b[0]-a[0], b[1]-a[1];length2 = dx*dx+dy*dy
            t = ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length2
            distance = abs(dx*(p[1]-a[1])-dy*(p[0]-a[0])) / math.sqrt(length2)
            if -.001 <= t <= 1 and distance <= g['width']/2+.001:
                correction = max(correction, (self.road(a,g['road'])-self.ground(a)-.08)*(1-max(0,t)))
        return self.ground(p)+.08+correction

    def register_passages(self, paths, gates, block_id):
        for i, path in enumerate(paths):
            profile=[]
            for a,b in zip(path,path[1:]):
                steps=max(1,math.ceil(math.dist(a,b)/3))
                for j in range(steps):
                    p=[a[k]+(b[k]-a[k])*j/steps for k in range(2)]
                    profile.append([*p,self.passage_height(p,gates)])
            p=path[-1];profile.append([*p,self.passage_height(p,gates)])
            self.profiles[block_id+'-passage-'+str(i)]=profile

    def fits(self, polygon, approach, door, road):
        low, high = self.range(polygon)
        rise = high + .14 - self.road(approach, road)
        length = math.dist(approach, door)
        ramp = abs(rise) <= length * .08
        steps = max(1, math.ceil(abs(rise)/.16))
        return high-low <= 2.4 and (ramp or length/steps >= .28)
