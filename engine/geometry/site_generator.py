import trimesh
from shapely.geometry import GeometryCollection, LineString, MultiPolygon, Point, Polygon
from shapely.ops import unary_union

from engine.regulation.setback_rules import resolve_setback
from services.gis import geo_utils
from services.gis.parcel_fetcher import (
    get_parcel_info,
    get_surrounding_parcels,
    resolve_jimok_code,
)

VISIBLE_RADIUS_M = 50.0
BOUNDARY_WIDTH_M = 0.35
PARCEL_HEIGHT_M = 0.08
PARCEL_BOUNDARY_WIDTH_M = 0.04
TARGET_BOUNDARY_WIDTH_M = 0.08
SETBACK_LINE_WIDTH_M = 0.048
SETBACK_DASH_M = 1.0
SETBACK_GAP_M = 0.65
LINE_OVERLAP_TOLERANCE_M = 0.08


def _extrude_polygon_mesh(
    polygon: Polygon | MultiPolygon | GeometryCollection,
    height: float,
) -> trimesh.Trimesh | None:
    if polygon.is_empty:
        return None

    polygons = []
    if isinstance(polygon, Polygon):
        polygons = [polygon]
    elif isinstance(polygon, MultiPolygon):
        polygons = list(polygon.geoms)
    elif isinstance(polygon, GeometryCollection):
        polygons = [geom for geom in polygon.geoms if isinstance(geom, Polygon)]

    meshes = []
    for poly in polygons:
        if poly.is_empty or poly.area <= 0:
            continue
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.is_empty or poly.area <= 0:
            continue

        try:
            meshes.append(trimesh.creation.extrude_polygon(poly, height=height))
        except Exception:
            continue

    if not meshes:
        return None

    if len(meshes) == 1:
        return meshes[0]

    return trimesh.util.concatenate(meshes)


def _jimok_suffix(jimok: str | None, jimok_code: str | None) -> str:
    code = resolve_jimok_code(jimok, jimok_code)
    return f"lc_{code}" if code else "lc_unknown"


def _is_road_suffix(suffix: str) -> bool:
    return suffix == "lc_14"


def _visible_polygon(
    coords: list[tuple[float, float]],
    center: tuple[float, float],
    visible_area: Polygon,
) -> Polygon | MultiPolygon | GeometryCollection:
    projected = geo_utils.project_to_meters(coords, center)
    polygon = Polygon(projected)
    if not polygon.is_valid:
        polygon = polygon.buffer(0)
    return polygon.intersection(visible_area)


def _polygon_exterior_coords(
    polygon: Polygon | MultiPolygon | GeometryCollection,
    fallback: Polygon,
) -> list[tuple[float, float]]:
    if isinstance(polygon, Polygon) and not polygon.is_empty:
        return list(polygon.exterior.coords)

    if isinstance(polygon, MultiPolygon) and polygon.geoms:
        largest = max(polygon.geoms, key=lambda geom: geom.area)
        return list(largest.exterior.coords)

    if isinstance(polygon, GeometryCollection):
        polygons = [geom for geom in polygon.geoms if isinstance(geom, Polygon)]
        if polygons:
            largest = max(polygons, key=lambda geom: geom.area)
            return list(largest.exterior.coords)

    return list(fallback.exterior.coords)


def _polygon_parts(
    polygon: Polygon | MultiPolygon | GeometryCollection,
) -> list[Polygon]:
    if isinstance(polygon, Polygon):
        return [] if polygon.is_empty else [polygon]
    if isinstance(polygon, MultiPolygon):
        return [geom for geom in polygon.geoms if not geom.is_empty]
    if isinstance(polygon, GeometryCollection):
        return [geom for geom in polygon.geoms if isinstance(geom, Polygon) and not geom.is_empty]
    return []


def _create_boundary_mesh(
    polygon: Polygon | MultiPolygon | GeometryCollection,
    width_m: float,
    z: float,
) -> trimesh.Trimesh | None:
    line_buffers = []
    for poly in _polygon_parts(polygon):
        exterior = LineString(poly.exterior.coords)
        if exterior.is_empty:
            continue
        line_buffers.append(
            exterior.buffer(width_m / 2, cap_style=2, join_style=2)
        )

    if not line_buffers:
        return None

    boundary = line_buffers[0]
    for item in line_buffers[1:]:
        boundary = boundary.union(item)

    mesh = _extrude_polygon_mesh(boundary, height=0.06)
    if mesh is not None:
        mesh.apply_translation([0, 0, z])
    return mesh


def _line_coords(line: LineString) -> list[list[float]]:
    return [[round(float(x), 3), round(float(y), 3), PARCEL_HEIGHT_M] for x, y in line.coords]


def _extract_lines(geometry) -> list[LineString]:
    if geometry.is_empty:
        return []
    if isinstance(geometry, LineString):
        return [geometry] if len(geometry.coords) >= 2 else []
    if geometry.geom_type == "MultiLineString":
        return [line for line in geometry.geoms if len(line.coords) >= 2]
    if isinstance(geometry, GeometryCollection):
        lines = []
        for geom in geometry.geoms:
            lines.extend(_extract_lines(geom))
        return lines
    return []


def _polygon_boundary_lines(
    polygon: Polygon | MultiPolygon | GeometryCollection,
) -> list[LineString]:
    lines = []
    for poly in _polygon_parts(polygon):
        if len(poly.exterior.coords) >= 2:
            lines.append(LineString(poly.exterior.coords))
    return lines


def _parcel_line_data(
    analysis_polygon: Polygon | MultiPolygon | GeometryCollection,
    parcel_polygons: list[Polygon | MultiPolygon | GeometryCollection],
) -> dict:
    analysis_lines = _polygon_boundary_lines(analysis_polygon)
    analysis_union = unary_union(analysis_lines) if analysis_lines else GeometryCollection()

    parcel_lines = []
    for polygon in parcel_polygons:
        parcel_lines.extend(_polygon_boundary_lines(polygon))

    if parcel_lines:
        parcel_union = unary_union(parcel_lines)
        if not analysis_union.is_empty:
            parcel_union = parcel_union.difference(
                analysis_union.buffer(LINE_OVERLAP_TOLERANCE_M, cap_style=2, join_style=2)
            )
        deduped_parcel_lines = _extract_lines(parcel_union)
    else:
        deduped_parcel_lines = []

    return {
        "analysis": [_line_coords(line) for line in _extract_lines(analysis_union)],
        "parcels": [_line_coords(line) for line in deduped_parcel_lines],
    }


def _surface_parts(
    polygon: Polygon | MultiPolygon | GeometryCollection,
) -> list[list[list[float]]]:
    parts = []
    for poly in _polygon_parts(polygon):
        coords = [
            [round(float(x), 3), round(float(y), 3), PARCEL_HEIGHT_M]
            for x, y in poly.exterior.coords
        ]
        if len(coords) >= 4:
            parts.append(coords)
    return parts


def _parcel_surface(
    parcel_id: str,
    role: str,
    suffix: str,
    polygon: Polygon | MultiPolygon | GeometryCollection,
    is_road: bool,
) -> dict | None:
    parts = _surface_parts(polygon)
    if not parts:
        return None

    return {
        "id": parcel_id,
        "role": role,
        "landCode": suffix,
        "isRoad": is_road,
        "z": PARCEL_HEIGHT_M,
        "parts": parts,
    }


def _segments_from_linestring(line: LineString) -> list[LineString]:
    coords = list(line.coords)
    if len(coords) < 2:
        return []

    cycle = SETBACK_DASH_M + SETBACK_GAP_M
    travelled = 0.0
    segments: list[LineString] = []

    for start, end in zip(coords, coords[1:]):
        x1, y1 = start
        x2, y2 = end
        dx = x2 - x1
        dy = y2 - y1
        length = (dx * dx + dy * dy) ** 0.5
        if length == 0:
            continue

        local = 0.0
        while local < length:
            phase = (travelled + local) % cycle
            if phase < SETBACK_DASH_M:
                dash_remaining = SETBACK_DASH_M - phase
                end_local = min(length, local + dash_remaining)
                t1 = local / length
                t2 = end_local / length
                segments.append(
                    LineString(
                        [
                            (x1 + dx * t1, y1 + dy * t1),
                            (x1 + dx * t2, y1 + dy * t2),
                        ]
                    )
                )
                local = end_local
            else:
                gap_remaining = cycle - phase
                local = min(length, local + gap_remaining)

        travelled += length

    return segments


def _create_dashed_line_mesh(
    polygon: Polygon | MultiPolygon | GeometryCollection,
    width_m: float,
    z: float,
) -> trimesh.Trimesh | None:
    vertices = []
    faces = []
    height = 0.04

    for poly in _polygon_parts(polygon):
        for segment in _segments_from_linestring(LineString(poly.exterior.coords)):
            coords = list(segment.coords)
            if len(coords) != 2:
                continue

            (x1, y1), (x2, y2) = coords
            dx = x2 - x1
            dy = y2 - y1
            length = (dx * dx + dy * dy) ** 0.5
            if length <= 0:
                continue

            nx = -dy / length * width_m / 2
            ny = dx / length * width_m / 2
            base = len(vertices)
            vertices.extend(
                [
                    (x1 + nx, y1 + ny, z),
                    (x1 - nx, y1 - ny, z),
                    (x2 - nx, y2 - ny, z),
                    (x2 + nx, y2 + ny, z),
                    (x1 + nx, y1 + ny, z + height),
                    (x1 - nx, y1 - ny, z + height),
                    (x2 - nx, y2 - ny, z + height),
                    (x2 + nx, y2 + ny, z + height),
                ]
            )
            faces.extend(
                [
                    (base + 0, base + 1, base + 2),
                    (base + 0, base + 2, base + 3),
                    (base + 4, base + 6, base + 5),
                    (base + 4, base + 7, base + 6),
                    (base + 0, base + 4, base + 5),
                    (base + 0, base + 5, base + 1),
                    (base + 1, base + 5, base + 6),
                    (base + 1, base + 6, base + 2),
                    (base + 2, base + 6, base + 7),
                    (base + 2, base + 7, base + 3),
                    (base + 3, base + 7, base + 4),
                    (base + 3, base + 4, base + 0),
                ]
            )

    if not vertices:
        return None

    return trimesh.Trimesh(vertices=vertices, faces=faces, process=False)


def _create_setback_mesh(
    site_polygon: Polygon | MultiPolygon | GeometryCollection,
    distance_m: float,
) -> trimesh.Trimesh | None:
    if distance_m <= 0:
        return None

    offset = site_polygon.buffer(-distance_m, join_style=2)
    if offset.is_empty:
        return None

    return _create_dashed_line_mesh(
        offset,
        width_m=SETBACK_LINE_WIDTH_M,
        z=0.76,
    )


def _create_visible_boundary_mesh() -> trimesh.Trimesh | None:
    outer = Point(0, 0).buffer(VISIBLE_RADIUS_M + BOUNDARY_WIDTH_M / 2, resolution=128)
    inner = Point(0, 0).buffer(VISIBLE_RADIUS_M - BOUNDARY_WIDTH_M / 2, resolution=128)
    ring = outer.difference(inner)
    mesh = _extrude_polygon_mesh(ring, height=0.04)
    if mesh is not None:
        mesh.apply_translation([0, 0, PARCEL_HEIGHT_M + 0.06])
    return mesh


def _create_north_arrow_mesh() -> trimesh.Trimesh | None:
    scale = 0.1
    shaft_half_width = 0.9 * scale
    head_half_width = 3.2 * scale
    shaft_bottom_y = -23.0 * scale
    shaft_top_y = 17.0 * scale
    head_base_y = 17.0 * scale
    head_tip_y = 26.5 * scale

    arrow = Polygon(
        [
            (-shaft_half_width, shaft_bottom_y),
            (shaft_half_width, shaft_bottom_y),
            (shaft_half_width, shaft_top_y),
            (head_half_width, head_base_y),
            (0.0, head_tip_y),
            (-head_half_width, head_base_y),
            (-shaft_half_width, shaft_top_y),
        ]
    )
    mesh = _extrude_polygon_mesh(arrow, height=0.16)
    if mesh is not None:
        mesh.apply_translation([-(VISIBLE_RADIUS_M + 6.0), 0, PARCEL_HEIGHT_M + 0.12])
    return mesh


def generate_site_scene(
    address: str,
    building_use: str | None = None,
    enable_setback: bool = False,
) -> dict:
    parcel = get_parcel_info(address)
    coords = parcel["coordinates"]
    center = Polygon(coords).centroid
    display_center = (center.x, center.y)
    visible_area = Point(0, 0).buffer(VISIBLE_RADIUS_M, resolution=96)

    visible_site = _visible_polygon(coords, display_center, visible_area)
    site_mesh = _extrude_polygon_mesh(visible_site, height=PARCEL_HEIGHT_M)
    if site_mesh is None:
        site_mesh = trimesh.creation.extrude_polygon(visible_area, height=PARCEL_HEIGHT_M)

    normalized = _polygon_exterior_coords(visible_site, visible_area)
    surrounding = get_surrounding_parcels(coords, parcel.get("pnu"), radius_m=50)
    target_suffix = _jimok_suffix(
        (parcel.get("land") or {}).get("jimok"),
        (parcel.get("land") or {}).get("jimok_code"),
    )

    surrounding_meshes = []
    road_meshes = []
    non_road_visible_parcels = []
    parcel_surfaces = []
    analysis_surface = _parcel_surface(
        "analysis_site",
        "analysis",
        target_suffix,
        visible_site,
        is_road=_is_road_suffix(target_suffix),
    )
    if analysis_surface:
        parcel_surfaces.append(analysis_surface)

    for index, nearby in enumerate(surrounding):
        visible_parcel = _visible_polygon(
            nearby["coordinates"],
            display_center,
            visible_area,
        )

        suffix = _jimok_suffix(nearby.get("jimok"), nearby.get("jimok_code"))
        is_road = nearby.get("is_road") or _is_road_suffix(suffix)
        surface = _parcel_surface(
            f"parcel_{index}",
            "road" if is_road else "surrounding",
            suffix,
            visible_parcel,
            is_road=is_road,
        )
        if surface:
            parcel_surfaces.append(surface)

        if is_road:
            continue
        else:
            non_road_visible_parcels.append(visible_parcel)

    visible_boundary_mesh = _create_visible_boundary_mesh()
    north_arrow_mesh = _create_north_arrow_mesh()
    target_boundary_mesh = None
    parcel_line_data = _parcel_line_data(visible_site, non_road_visible_parcels)
    setback = resolve_setback(building_use) if enable_setback else None
    setback_mesh = (
        _create_setback_mesh(visible_site, float(setback["distance_m"]))
        if setback
        else None
    )

    return {
        "parcel": parcel,
        "surrounding_parcels": surrounding,
        "visible_radius_m": VISIBLE_RADIUS_M,
        "normalized_coords": normalized,
        "site_name": f"analysis_site_{target_suffix}",
        "site_mesh": site_mesh,
        "surrounding_meshes": surrounding_meshes,
        "road_meshes": road_meshes,
        "parcel_boundary_meshes": [],
        "parcel_surfaces": parcel_surfaces,
        "parcel_line_data": parcel_line_data,
        "target_boundary_mesh": target_boundary_mesh,
        "setback_mesh": setback_mesh,
        "setback": setback,
        "visible_boundary_mesh": visible_boundary_mesh,
        "north_arrow_mesh": north_arrow_mesh,
    }
