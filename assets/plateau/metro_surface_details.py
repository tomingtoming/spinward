"""Vector colour boundaries draped onto the existing terrain triangles.

Clip before triangulating: every resulting face stays in one original DEM
triangle, including partial cells at the outside edges of a strip.
"""
import numpy as np
import shapely
from shapely import STRtree

from metro_geometry import terrain_mesh, weld
from prepare_metro_overview import linear_colour


class SurfaceDraper:
    def __init__(self, grid, bounds):
        self.grid = grid
        self.mesh = terrain_mesh(grid, bounds, 5)
        self.faces = self.mesh['position'][self.mesh['index'].reshape(-1, 3)].astype(float)
        self.polygons = shapely.polygons(self.faces[:, :, :2])
        self.tree = STRtree(self.polygons)

    def paint(self, shape, colour, lift=.016):
        if shape.is_empty:
            return None
        candidates = self.tree.query(shape, predicate='intersects')
        if not len(candidates):
            return None
        inside = shapely.covers(shape, self.polygons[candidates])
        full = self.faces[candidates[inside]].reshape(-1, 3)
        boundary = candidates[~inside]
        pieces, parents = shapely.get_parts(
            shapely.intersection(self.polygons[boundary], shape), return_index=True)
        area = shapely.area(pieces) > 1e-8
        pieces, parents = pieces[area], parents[area]
        triangles, owners = shapely.get_parts(
            shapely.constrained_delaunay_triangles(pieces), return_index=True)
        if len(triangles):
            xy = shapely.get_coordinates(shapely.get_exterior_ring(triangles)).reshape(-1, 4, 2)[:, :3]
            original = self.faces[boundary[parents[owners]]]
            a = original[:, 1, :2] - original[:, 0, :2]
            b = original[:, 2, :2] - original[:, 0, :2]
            d = xy - original[:, 0, None, :2]
            det = a[:, 0]*b[:, 1] - a[:, 1]*b[:, 0]
            u = (d[:, :, 0]*b[:, None, 1] - d[:, :, 1]*b[:, None, 0])/det[:, None]
            v = (a[:, None, 0]*d[:, :, 1] - a[:, None, 1]*d[:, :, 0])/det[:, None]
            z = original[:, None, 0, 2] + u*(original[:, None, 1, 2]-original[:, None, 0, 2]) + v*(original[:, None, 2, 2]-original[:, None, 0, 2])
            cut = np.concatenate([xy, z[:, :, None]], axis=2).reshape(-1, 3)
            full = np.concatenate([full, cut])
        if not len(full):
            return None
        # GEOS triangulation may return clockwise rings. Match the original
        # upward terrain faces, otherwise DoubleSide flips their lighting.
        faces = full.reshape(-1, 3, 3)
        a = faces[:, 1, :2] - faces[:, 0, :2]
        b = faces[:, 2, :2] - faces[:, 0, :2]
        reversed_faces = a[:, 0]*b[:, 1] - a[:, 1]*b[:, 0] < 0
        faces[reversed_faces] = faces[reversed_faces][:, [0, 2, 1]]
        full[:, 2] += lift
        position, index = weld(full, np.arange(len(full), dtype='<u4'))
        return dict(position=position, index=index,
                    normal=self.grid.normals(position[:, 0], position[:, 1]).astype('<f4'),
                    color=np.tile(linear_colour(colour), (len(position), 1)).astype('<f4'))
