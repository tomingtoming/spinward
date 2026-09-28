"""Dimensioned left-hand JCT alignments in unwrapped colony coordinates.

Geometry only: site selection, vertical clearance and native acceptance are
separate. End junctions have one longitudinal arm, never a fictitious fourth.
"""
import math

LANE = 6.
OUTER = 540.
LOOP = 80.


def rotate(point, quarter):
    x, y = point
    return [(x, y), (-y, x), (-x, -y), (y, -x)][quarter % 4]


def movements(ident, x, y, terminal=0):
    """terminal +1/-1 removes the north/south longitudinal arm respectively."""
    result = []
    # Headings are north, west, south, east. Proper rotations preserve the
    # left carriageway. Left turns use the outer quadrant; right turns pass
    # the crossing before following a 270-degree inner loop. Both exit to the
    # left, without crossing the opposing carriageway.
    for quarter in range(4):
        start_heading = rotate((0, 1), quarter)
        for turn in ['right', 'left']:
            end_heading = rotate((1, 0) if turn == 'right' else (-1, 0), quarter)
            if terminal and (start_heading == (0, -terminal) or end_heading == (0, terminal)):
                continue
            if turn == 'left':
                cx, cy, radius, sweep = -OUTER, -OUTER, OUTER - LANE, math.pi / 2
            else:
                cx, cy, radius, sweep = -LOOP, LOOP, LOOP - LANE, 3 * math.pi / 2
            count = math.ceil(abs(sweep) * radius / 6)
            points = []
            for i in range(count + 1):
                angle = sweep * i / count
                u, v = rotate((cx + radius * math.cos(angle), cy + radius * math.sin(angle)), quarter)
                points.append([x + u, y + v])
            result.append({'id': f'{ident}-{quarter}-{turn}', 'kind': 'ramp',
                           'width': 7., 'turn': turn, 'quarter': quarter,
                           'startHeading': list(start_heading), 'endHeading': list(end_heading),
                           'points': points})
    assert len(result) == (4 if terminal else 8)
    return result
