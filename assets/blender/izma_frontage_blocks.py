"""Partition urban street edges into contiguous addresses before placing houses.

The saved road edges bound blocks. Depth is shared with the opposite frontage;
corner parcels and existing public/transport reservations are checked by the
caller. These are authored-city dimensions, not measurements of an anime frame.
"""
import math


def catchment_intervals(a, b, station, axis, reach, half_width, anchor, radius):
    """Union of a station rectangle and a public-place circle on one segment."""
    delta = [b[k] - a[k] for k in range(2)]
    offset = [a[k] - station[k] for k in range(2)]
    intervals = []
    lo, hi = 0., 1.
    for normal, lower, upper in [(axis, 30, reach + 45),
                                  ((-axis[1], axis[0]), -half_width, half_width)]:
        p = sum(offset[k] * normal[k] for k in range(2))
        d = sum(delta[k] * normal[k] for k in range(2))
        if abs(d) < 1e-9:
            if not lower < p < upper: hi = -1
        else:
            aa, bb = sorted(((lower - p) / d, (upper - p) / d))
            lo, hi = max(lo, aa), min(hi, bb)
    if hi > lo: intervals.append((lo, hi))
    offset = [a[k] - anchor[k] for k in range(2)]
    aa = sum(v * v for v in delta)
    bb = 2 * sum(offset[k] * delta[k] for k in range(2))
    cc = sum(v * v for v in offset) - radius * radius
    disc = bb * bb - 4 * aa * cc
    if aa > 0 and disc > 0:
        lo, hi = max(0, (-bb - math.sqrt(disc)) / (2 * aa)), min(1, (-bb + math.sqrt(disc)) / (2 * aa))
        if hi > lo: intervals.append((lo, hi))
    merged = []
    for lo, hi in sorted(intervals):
        if merged and lo <= merged[-1][1]: merged[-1] = (merged[-1][0], max(hi, merged[-1][1]))
        else: merged.append((lo, hi))
    return merged


def available_depth(point, normal, route, segments, setback, rear, maximum):
    """Share a block's depth at the midpoint between facing road centre lines."""
    distance = math.inf
    for a, b, other, _ in segments:
        dx, dy = b[0] - a[0], b[1] - a[1]
        det = normal[0] * dy - normal[1] * dx
        if abs(det) < 1e-8: continue
        ax, ay = a[0] - point[0], a[1] - point[1]
        t = (ax * dy - ay * dx) / det
        u = (ax * normal[1] - ay * normal[0]) / det
        if t > route['width'] and 0 <= u <= 1:
            # The two road verges need not have the same width.
            distance = min(distance, (t - route['width'] / 2 - other['width'] / 2) / 2)
    return min(maximum, distance - setback - rear)


def dimensions(family, character, seed, config):
    """A block has deep narrow shops, houses, courts and larger work premises."""
    spec = config['families'][family]
    if family == 'shop-house': widths, depths = [7.2, 9.2, 11.2], [24, 20, 16, 12]
    elif family == 'house': widths, depths = [7.6, 9.2, 10.8], [15, 12, 10]
    elif family == 'apartment': widths, depths = [22, 30, 38], [26, 22, 18, 16]
    elif family == 'office': widths, depths = [18, 24, 30], [28, 24, 20, 18]
    elif family == 'workshop': widths, depths = [16, 22, 28], [28, 24, 20, 18]
    else: widths, depths = spec['width'], [spec['depth']]
    if character == 'works' and family == 'apartment': widths = [18, 22, 26]
    width = widths[seed % len(widths)]
    return [width, min(width, widths[0])], depths
