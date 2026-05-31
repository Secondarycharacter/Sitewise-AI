from math import ceil
from typing import Any

import trimesh
from shapely.affinity import scale as scale_geometry
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon

DEFAULT_FLOOR_HEIGHT_M = 4.0
MAX_ENVELOPE_HEIGHT_M = 60.0


def _buildable_footprint(
    normalized_coords: list[tuple[float, float]],
    bcr_percent: float,
    max_building_area_m2: float | None = None,
) -> Polygon | None:
    site_poly = Polygon(normalized_coords)
    if not site_poly.is_valid:
        site_poly = site_poly.buffer(0)

    capped_bcr = min(max(float(bcr_percent), 0.0), 100.0)
    scale = (capped_bcr / 100) ** 0.5
    if scale <= 0:
        return None

    centroid = site_poly.centroid
    footprint_coords = [
        (
            centroid.x + (x - centroid.x) * scale,
            centroid.y + (y - centroid.y) * scale,
        )
        for x, y in normalized_coords
    ]

    footprint_poly = Polygon(footprint_coords)
    if not footprint_poly.is_valid:
        footprint_poly = footprint_poly.buffer(0)
    footprint_poly = footprint_poly.intersection(site_poly)
    footprint_poly = _largest_polygon(footprint_poly)

    max_area = _positive_float(max_building_area_m2, default=0)
    if footprint_poly is not None and max_area > 0 and footprint_poly.area > max_area:
        area_scale = (max_area / footprint_poly.area) ** 0.5
        origin = footprint_poly.representative_point()
        footprint_poly = scale_geometry(
            footprint_poly,
            xfact=area_scale,
            yfact=area_scale,
            origin=(origin.x, origin.y),
        ).intersection(site_poly)
        footprint_poly = _largest_polygon(footprint_poly)

    return footprint_poly


def _largest_polygon(geometry) -> Polygon | None:
    if geometry.is_empty:
        return None
    if isinstance(geometry, Polygon):
        return geometry if geometry.area > 0 else None
    if isinstance(geometry, MultiPolygon):
        polygons = [geom for geom in geometry.geoms if geom.area > 0]
        return max(polygons, key=lambda geom: geom.area) if polygons else None
    if isinstance(geometry, GeometryCollection):
        polygons = [geom for geom in geometry.geoms if isinstance(geom, Polygon) and geom.area > 0]
        return max(polygons, key=lambda geom: geom.area) if polygons else None
    return None


def _envelope_height(
    bcr_percent: float,
    far_percent: float,
    max_height_m: float | None = None,
) -> float:
    height = DEFAULT_FLOOR_HEIGHT_M * (far_percent / max(bcr_percent, 1))
    if max_height_m:
        height = min(height, float(max_height_m))
    return min(max(height, DEFAULT_FLOOR_HEIGHT_M), MAX_ENVELOPE_HEIGHT_M)


def _positive_float(value: Any, default: float = DEFAULT_FLOOR_HEIGHT_M) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if number > 0 else default


def _floor_heights_from_settings(
    model_settings: dict[str, Any] | None,
    total_height_m: float,
) -> list[float]:
    raw_heights = (model_settings or {}).get("floorHeights")
    if isinstance(raw_heights, list):
        heights = [_positive_float(value) for value in raw_heights]
        if heights:
            return heights

    floor_count = max(1, ceil(total_height_m / DEFAULT_FLOOR_HEIGHT_M))
    return [DEFAULT_FLOOR_HEIGHT_M for _ in range(floor_count)]


def _basement_heights_from_settings(model_settings: dict[str, Any] | None) -> list[float]:
    settings = model_settings or {}
    try:
        basement_count = max(0, int(settings.get("basementFloors") or 0))
    except (TypeError, ValueError):
        basement_count = 0

    raw_heights = settings.get("basementFloorHeights")
    heights = []
    if isinstance(raw_heights, list):
        heights = [_positive_float(value) for value in raw_heights[:basement_count]]

    while len(heights) < basement_count:
        heights.append(DEFAULT_FLOOR_HEIGHT_M)
    return heights


def _uses_from_settings(
    model_settings: dict[str, Any] | None,
    key: str,
    count: int,
) -> list[str]:
    raw_uses = (model_settings or {}).get(key)
    uses = []
    if isinstance(raw_uses, list):
        uses = [str(value).strip() for value in raw_uses[:count]]

    while len(uses) < count:
        uses.append("")
    return uses


def _footprint_points(footprint_poly: Polygon) -> list[list[float]]:
    return [
        [round(float(x), 3), round(float(y), 3)]
        for x, y in footprint_poly.exterior.coords
    ]


def create_buildable_floor_masses(
    normalized_coords: list[tuple[float, float]],
    bcr_percent: float,
    far_percent: float,
    max_height_m: float | None = None,
    model_settings: dict[str, Any] | None = None,
    max_building_area_m2: float | None = None,
) -> tuple[list[tuple[str, trimesh.Trimesh]], dict[str, Any], list[dict[str, Any]]]:
    if len(normalized_coords) < 3:
        return [], {}, []

    footprint_poly = _buildable_footprint(
        normalized_coords,
        bcr_percent,
        max_building_area_m2=max_building_area_m2,
    )
    if footprint_poly is None:
        return [], {}, []

    total_height_m = _envelope_height(bcr_percent, far_percent, max_height_m)
    floor_heights = _floor_heights_from_settings(model_settings, total_height_m)
    basement_heights = _basement_heights_from_settings(model_settings)
    floor_uses = _uses_from_settings(model_settings, "floorUses", len(floor_heights))
    basement_uses = _uses_from_settings(
        model_settings,
        "basementFloorUses",
        len(basement_heights),
    )

    meshes: list[tuple[str, trimesh.Trimesh]] = []
    footprint_points = _footprint_points(footprint_poly)
    floor_area_m2 = round(float(footprint_poly.area), 1)
    floor_plans: list[dict[str, Any]] = []
    current_z = 0.08
    for index, height in enumerate(floor_heights, start=1):
        mesh = trimesh.creation.extrude_polygon(footprint_poly, height=height)
        mesh.apply_translation([0, 0, current_z])
        meshes.append((f"buildable_floor_{index:02d}", mesh))
        floor_plans.append(
            {
                "id": f"floor_{index:02d}",
                "type": "above",
                "label": f"지상 {index}층",
                "use": floor_uses[index - 1],
                "areaM2": floor_area_m2,
                "heightM": round(height, 2),
                "zMin": round(current_z, 2),
                "zMax": round(current_z + height, 2),
                "points": footprint_points,
            }
        )
        current_z += height

    current_z = 0.0
    for index, height in enumerate(basement_heights, start=1):
        current_z -= height
        mesh = trimesh.creation.extrude_polygon(footprint_poly, height=height)
        mesh.apply_translation([0, 0, current_z])
        meshes.append((f"basement_floor_{index:02d}", mesh))
        floor_plans.append(
            {
                "id": f"basement_{index:02d}",
                "type": "basement",
                "label": f"지하 {index}층",
                "use": basement_uses[index - 1],
                "areaM2": floor_area_m2,
                "heightM": round(height, 2),
                "zMin": round(current_z, 2),
                "zMax": round(current_z + height, 2),
                "points": footprint_points,
            }
        )

    floor_plans = [
        *reversed([plan for plan in floor_plans if plan["type"] == "basement"]),
        *[plan for plan in floor_plans if plan["type"] == "above"],
    ]

    overview_keys = (
        "buildingStructure",
        "parkingCount",
        "landscapeInstalledArea",
        "landscapeLegalArea",
        "siteSetbackAdjacentM",
        "siteSetbackBuildingLineM",
    )
    overview_settings = {
        key: (model_settings or {}).get(key, "")
        for key in overview_keys
    }
    if not str(overview_settings.get("buildingStructure") or "").strip():
        overview_settings["buildingStructure"] = "철근콘크리트 라멘조"
    if overview_settings.get("siteSetbackAdjacentM") in (None, ""):
        overview_settings["siteSetbackAdjacentM"] = 0.5
    if overview_settings.get("siteSetbackBuildingLineM") in (None, ""):
        overview_settings["siteSetbackBuildingLineM"] = 0.5

    return meshes, {
        "floorHeights": [round(height, 2) for height in floor_heights],
        "basementFloors": len(basement_heights),
        "basementFloorHeights": [round(height, 2) for height in basement_heights],
        "floorUses": floor_uses,
        "basementFloorUses": basement_uses,
        "estimatedEnvelopeHeightM": round(sum(floor_heights), 2),
        **overview_settings,
    }, floor_plans


def create_buildable_envelope(
    normalized_coords: list[tuple[float, float]],
    bcr_percent: float,
    far_percent: float,
    max_height_m: float | None = None,
) -> trimesh.Trimesh | None:
    meshes, _settings, _floor_plans = create_buildable_floor_masses(
        normalized_coords,
        bcr_percent,
        far_percent,
        max_height_m,
    )
    if not meshes:
        return None

    return trimesh.util.concatenate([mesh for _name, mesh in meshes])
