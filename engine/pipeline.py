from engine.export.glb_exporter import export_scene
from engine.geometry.envelope_generator import create_buildable_floor_masses
from engine.regulation.regulation_engine import analyze_regulations


def _positive_percent(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _apply_regulation_overrides(regulations: dict, overrides: dict | None) -> dict:
    if not overrides or not regulations.get("limits"):
        return regulations

    limits = dict(regulations["limits"])
    bcr = _positive_percent(overrides.get("bcrPercent"))
    far = _positive_percent(overrides.get("farPercent"))
    if bcr is not None:
        limits["bcr_percent"] = bcr
    if far is not None:
        limits["far_percent"] = far

    computed = dict(regulations.get("computed") or {})
    site_area_m2 = float(computed.get("site_area_m2") or 0)
    if site_area_m2 > 0:
        computed["max_building_area_m2"] = round(site_area_m2 * limits["bcr_percent"] / 100, 2)
        computed["max_gross_floor_area_m2"] = round(site_area_m2 * limits["far_percent"] / 100, 2)

    updated = dict(regulations)
    updated["limits"] = limits
    updated["computed"] = computed
    updated["overridden"] = bcr is not None or far is not None
    if updated["overridden"]:
        notes = list(updated.get("notes") or [])
        notes.append("건폐율·용적률은 사용자가 입력한 값으로 모델링에 반영되었습니다.")
        updated["notes"] = notes
    return updated


def run_phase2_pipeline(
    address: str,
    building_use: str | None = None,
    model_settings: dict | None = None,
    regulation_overrides: dict | None = None,
) -> dict:
    from engine.geometry.site_generator import generate_site_scene

    scene = generate_site_scene(address, building_use=building_use, enable_setback=False)
    parcel = scene["parcel"]
    regulations = _apply_regulation_overrides(
        analyze_regulations(parcel),
        regulation_overrides,
    )

    meshes = []
    if scene.get("target_boundary_mesh") is not None:
        meshes.append(("analysis_site_boundary", scene["target_boundary_mesh"]))
    if scene.get("setback_mesh") is not None:
        meshes.append(("site_setback_dashed", scene["setback_mesh"]))
    if scene.get("visible_boundary_mesh") is not None:
        meshes.append(("visible_radius_boundary", scene["visible_boundary_mesh"]))
    if scene.get("north_arrow_mesh") is not None:
        meshes.append(("north_arrow", scene["north_arrow_mesh"]))
    limits = regulations.get("limits")
    resolved_model_settings = model_settings or {}
    floor_plans = []

    if limits and regulations.get("available"):
        floor_meshes, resolved_model_settings, floor_plans = create_buildable_floor_masses(
            scene["normalized_coords"],
            limits["bcr_percent"],
            limits["far_percent"],
            limits.get("max_height_m"),
            model_settings=model_settings,
            max_building_area_m2=(regulations.get("computed") or {}).get("max_building_area_m2"),
        )
        meshes.extend(floor_meshes)

    model_url = export_scene(*meshes)

    return {
        "success": True,
        "modelUrl": model_url,
        "parcel": {
            "address": parcel.get("address"),
            "road_address": parcel.get("road_address"),
            "pnu": parcel.get("pnu"),
            "area_m2": parcel.get("area_m2"),
            "geometry_source": parcel.get("geometry_source"),
            "centroid": parcel.get("centroid"),
            "warnings": parcel.get("warnings", []),
        },
        "surrounding": {
            "search_radius_m": 50,
            "visible_radius_m": scene.get("visible_radius_m"),
            "count": len(scene.get("surrounding_parcels", [])),
            "road_count": len(
                [p for p in scene.get("surrounding_parcels", []) if p.get("is_road")]
            ),
            "visible_count": max(0, len(scene.get("parcel_surfaces", [])) - 1),
            "visible_road_count": len(
                [p for p in scene.get("parcel_surfaces", []) if p.get("isRoad")]
            ),
        },
        "setback": scene.get("setback"),
        "parcelSurfaces": scene.get("parcel_surfaces", []),
        "boundaryLines": scene.get("parcel_line_data", {"analysis": [], "parcels": []}),
        "floorPlans": floor_plans,
        "modelSettings": resolved_model_settings,
        "regulations": regulations,
    }
