import math
from typing import Any


def parse_polygon_coordinates(geometry: dict[str, Any]) -> list[tuple[float, float]]:
    geom_type = geometry.get("type", "")
    coords = geometry.get("coordinates")

    if not coords:
        return []

    if geom_type == "Polygon":
        ring = coords[0]
        return [(float(x), float(y)) for x, y in ring]

    if geom_type == "MultiPolygon":
        ring = coords[0][0]
        return [(float(x), float(y)) for x, y in ring]

    return []


def normalize_coords(
    coords: list[tuple[float, float]],
    scale: float = 100000.0,
    origin: tuple[float, float] | None = None,
) -> list[tuple[float, float]]:
    if not coords:
        return []

    origin_x, origin_y = origin or coords[0]
    normalized = []
    for x, y in coords:
        normalized.append(((x - origin_x) * scale, (y - origin_y) * scale))
    return normalized


def polygon_area_m2_wgs84(coords: list[tuple[float, float]]) -> float:
    """경위도 좌표 폴리곤의 면적(㎡) 근사 계산."""
    if len(coords) < 3:
        return 0.0

    lat0 = math.radians(coords[0][1])
    lon0 = coords[0][0]
    projected: list[tuple[float, float]] = []

    for lon, lat in coords:
        x = (lon - lon0) * 111_320 * math.cos(lat0)
        y = (lat - coords[0][1]) * 110_540
        projected.append((x, y))

    area = 0.0
    n = len(projected)
    for i in range(n):
        x1, y1 = projected[i]
        x2, y2 = projected[(i + 1) % n]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0


def polygon_area_m2(coords: list[tuple[float, float]]) -> float:
    return polygon_area_m2_wgs84(coords)


def approximate_parcel_coords(
    x: float, y: float, side_m: float = 20.0
) -> list[tuple[float, float]]:
    """필지 경계 API 미사용 시, 좌표 중심의 근사 사각형(경위도)."""
    lat_rad = math.radians(y)
    d_lon = (side_m / 2) / (111_320 * math.cos(lat_rad))
    d_lat = (side_m / 2) / 110_540
    return [
        (x - d_lon, y - d_lat),
        (x + d_lon, y - d_lat),
        (x + d_lon, y + d_lat),
        (x - d_lon, y + d_lat),
    ]


def buffered_bbox(
    coords: list[tuple[float, float]], buffer_m: float
) -> tuple[float, float, float, float]:
    min_x = min(x for x, _ in coords)
    max_x = max(x for x, _ in coords)
    min_y = min(y for _, y in coords)
    max_y = max(y for _, y in coords)
    mid_y = (min_y + max_y) / 2

    d_lon = buffer_m / (111_320 * math.cos(math.radians(mid_y)))
    d_lat = buffer_m / 110_540
    return (min_x - d_lon, min_y - d_lat, max_x + d_lon, max_y + d_lat)


def project_to_meters(
    coords: list[tuple[float, float]], origin: tuple[float, float]
) -> list[tuple[float, float]]:
    origin_x, origin_y = origin
    lat0 = math.radians(origin_y)
    return [
        (
            (x - origin_x) * 111_320 * math.cos(lat0),
            (y - origin_y) * 110_540,
        )
        for x, y in coords
    ]


def polygon_distance_m(
    a: list[tuple[float, float]], b: list[tuple[float, float]]
) -> float:
    from shapely.geometry import Polygon

    if len(a) < 3 or len(b) < 3:
        return float("inf")

    origin = a[0]
    poly_a = Polygon(project_to_meters(a, origin))
    poly_b = Polygon(project_to_meters(b, origin))

    if not poly_a.is_valid:
        poly_a = poly_a.buffer(0)
    if not poly_b.is_valid:
        poly_b = poly_b.buffer(0)

    return float(poly_a.distance(poly_b))
