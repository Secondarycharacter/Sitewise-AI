"""Building program model for overview-driven regulation calculations.

The parking engine needs more than floor area totals for housing, officetel, and
mixed-use projects. This module creates a normalized summary that can accept
explicit area schedules later while still producing a useful first-pass summary
from the current floorPlans data.
"""

from __future__ import annotations

from typing import Any

from engine.regulation.building_use_classifier import classify_building_use

COMMON_AREA_KEYWORDS = ("공용", "복도", "계단", "코어", "기계", "전기", "설비", "EPS", "TPS")
PARKING_AREA_KEYWORDS = ("주차", "parking")
LANDSCAPE_AREA_KEYWORDS = ("조경", "landscape")

PROJECT_TYPE_LABELS = {
    "general_building": "일반건축물",
    "officetel": "오피스텔",
    "mixed_use_officetel": "오피스텔+일반건축용도",
    "neighborhood_house": "상가주택",
    "multi_family_house": "다가구주택",
    "apartment": "공동주택/아파트",
    "mixed_use_residential": "주상복합/복합주거",
    "mixed_use_general": "복합 일반건축물",
    "unknown": "미분류",
}


def _float_value(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if number > 0 else 0.0


def _rounded(value: float) -> float:
    return round(float(value or 0.0), 3)


def _use_text(value: Any) -> str:
    return str(value or "").strip()


def _area_kind(use: str, explicit_kind: str | None = None) -> str:
    if explicit_kind:
        normalized = explicit_kind.strip().lower()
        if normalized in ("exclusive", "common", "parking", "mechanical", "landscape", "service_common"):
            return normalized
    lower = use.lower()
    if any(keyword.lower() in lower for keyword in PARKING_AREA_KEYWORDS):
        return "parking"
    if any(keyword.lower() in lower for keyword in LANDSCAPE_AREA_KEYWORDS):
        return "landscape"
    if any(keyword.lower() in lower for keyword in COMMON_AREA_KEYWORDS):
        return "common"
    return "exclusive"


def _program_area_components(
    floor_plans: list[dict[str, Any]],
    model_settings: dict[str, Any] | None,
    building_use_taxonomy: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    explicit_components = ((model_settings or {}).get("buildingProgram") or {}).get("areaComponents")
    if isinstance(explicit_components, list) and explicit_components:
        source_components = explicit_components
        source = "model_settings.buildingProgram.areaComponents"
    else:
        source_components = floor_plans or []
        source = "floorPlans"

    components: list[dict[str, Any]] = []
    for index, item in enumerate(source_components):
        use = _use_text(item.get("use")) or "그 밖의 건축물"
        area_m2 = _float_value(item.get("areaM2") or item.get("grossAreaM2"))
        kind = _area_kind(use, item.get("areaKind") or item.get("kind"))
        legal_use = classify_building_use(use, building_use_taxonomy)
        components.append(
            {
                "id": item.get("id") or f"area_component_{index + 1:02d}",
                "source": source,
                "floorId": item.get("floorId") or item.get("id"),
                "floorLabel": item.get("floorLabel") or item.get("label"),
                "floorType": item.get("floorType") or item.get("type"),
                "use": use,
                "areaKind": kind,
                "areaM2": _rounded(area_m2),
                "legalUse": legal_use,
                "allocationTargetUse": item.get("allocationTargetUse"),
                "allocationMethod": item.get("allocationMethod"),
            }
        )
    return components


def _group_components(components: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for component in components:
        legal_use = component.get("legalUse") or {}
        key = str(legal_use.get("subcategory") or legal_use.get("categoryName") or component.get("use") or "unknown")
        group = grouped.setdefault(
            key,
            {
                "key": key,
                "label": key,
                "categoryName": legal_use.get("categoryName"),
                "subcategory": legal_use.get("subcategory"),
                "parkingCategory": legal_use.get("parkingCategory"),
                "authoritative": bool(legal_use.get("authoritative")),
                "exclusiveAreaM2": 0.0,
                "commonAreaM2": 0.0,
                "parkingAreaM2": 0.0,
                "grossAreaM2": 0.0,
                "components": [],
            },
        )
        area = _float_value(component.get("areaM2"))
        kind = component.get("areaKind")
        group["grossAreaM2"] += area
        if kind == "exclusive":
            group["exclusiveAreaM2"] += area
        elif kind in ("common", "mechanical", "service_common"):
            group["commonAreaM2"] += area
        elif kind == "parking":
            group["parkingAreaM2"] += area
        group["components"].append(component.get("id"))

    return [
        {
            **group,
            "exclusiveAreaM2": _rounded(group["exclusiveAreaM2"]),
            "commonAreaM2": _rounded(group["commonAreaM2"]),
            "parkingAreaM2": _rounded(group["parkingAreaM2"]),
            "grossAreaM2": _rounded(group["grossAreaM2"]),
        }
        for group in grouped.values()
    ]


def _is_housing_group(group: dict[str, Any]) -> bool:
    return group.get("parkingCategory") in ("housing_standard", "detached_house", "dormitory")


def _is_officetel_group(group: dict[str, Any]) -> bool:
    return group.get("subcategory") == "오피스텔" or "오피스텔" in str(group.get("label") or "")


def _is_general_group(group: dict[str, Any]) -> bool:
    parking_category = group.get("parkingCategory")
    return parking_category not in ("housing_standard", "detached_house", "dormitory") and group.get("exclusiveAreaM2", 0) > 0


def _infer_project_type(use_groups: list[dict[str, Any]]) -> tuple[str, str]:
    housing = [group for group in use_groups if _is_housing_group(group)]
    officetel = [group for group in use_groups if _is_officetel_group(group)]
    general = [group for group in use_groups if _is_general_group(group)]
    detached = [group for group in housing if group.get("parkingCategory") == "detached_house"]
    multi_family = [group for group in housing if group.get("subcategory") == "다가구주택"]
    apartment = [group for group in housing if group.get("categoryName") == "공동주택" and not _is_officetel_group(group)]

    if officetel and general:
        project_type = "mixed_use_officetel"
    elif officetel:
        project_type = "officetel"
    elif (detached or multi_family) and general:
        project_type = "neighborhood_house"
    elif multi_family or detached:
        project_type = "multi_family_house"
    elif apartment and general:
        project_type = "mixed_use_residential"
    elif apartment:
        project_type = "apartment"
    elif len(general) > 1:
        project_type = "mixed_use_general"
    elif general:
        project_type = "general_building"
    else:
        project_type = "unknown"
    return project_type, PROJECT_TYPE_LABELS[project_type]


def _unit_summary(model_settings: dict[str, Any] | None) -> dict[str, Any]:
    program = (model_settings or {}).get("buildingProgram") or {}
    raw_units = program.get("units")
    units = raw_units if isinstance(raw_units, list) else []
    normalized_units = []
    total_units = 0
    total_exclusive = 0.0
    for index, unit in enumerate(units):
        count = int(_float_value(unit.get("count") or 1)) or 1
        unit_exclusive = _float_value(unit.get("exclusiveAreaM2") or unit.get("unitExclusiveAreaM2"))
        unit_total_exclusive = count * unit_exclusive
        total_units += count
        total_exclusive += unit_total_exclusive
        normalized_units.append(
            {
                **unit,
                "id": unit.get("id") or f"unit_group_{index + 1:02d}",
                "count": count,
                "unitExclusiveAreaM2": _rounded(unit_exclusive),
                "totalExclusiveAreaM2": _rounded(unit_total_exclusive),
            }
        )
    return {
        "unitCount": total_units,
        "unitExclusiveAreaM2": _rounded(total_exclusive),
        "totalExclusiveAreaM2": _rounded(total_exclusive),
        "units": normalized_units,
        "hasExplicitUnits": bool(units),
    }


def _common_area_allocation(use_groups: list[dict[str, Any]], model_settings: dict[str, Any] | None) -> dict[str, Any]:
    program = (model_settings or {}).get("buildingProgram") or {}
    method = program.get("commonAreaAllocationMethod") or "exclusive_area_ratio"
    common_area = sum(_float_value(group.get("commonAreaM2")) for group in use_groups)
    exclusive_total = sum(_float_value(group.get("exclusiveAreaM2")) for group in use_groups)

    if common_area <= 0:
        return {
            "status": "not_required",
            "method": method,
            "commonAreaM2": 0,
            "allocations": [],
            "needsManualReview": False,
        }

    allocations = []
    if exclusive_total > 0:
        for group in use_groups:
            exclusive = _float_value(group.get("exclusiveAreaM2"))
            if exclusive <= 0:
                continue
            ratio = exclusive / exclusive_total
            allocations.append(
                {
                    "useGroup": group.get("key"),
                    "exclusiveAreaM2": _rounded(exclusive),
                    "ratio": round(ratio, 6),
                    "allocatedCommonAreaM2": _rounded(common_area * ratio),
                    "allocationBasis": method,
                }
            )
        status = "candidate"
    else:
        status = "needs_input"

    return {
        "status": status,
        "method": method,
        "commonAreaM2": _rounded(common_area),
        "exclusiveAreaTotalM2": _rounded(exclusive_total),
        "allocations": allocations,
        "needsManualReview": True,
    }


def _parking_readiness(
    project_type: str,
    use_groups: list[dict[str, Any]],
    unit_summary: dict[str, Any],
    common_allocation: dict[str, Any],
) -> dict[str, Any]:
    has_housing = any(_is_housing_group(group) for group in use_groups)
    has_general = any(_is_general_group(group) for group in use_groups)
    missing_inputs = []
    if has_housing and not unit_summary.get("hasExplicitUnits"):
        missing_inputs.append("주택/오피스텔 세대·호실별 전용면적")
    if common_allocation.get("status") == "candidate":
        missing_inputs.append("공용면적 배분 방식 최종확인")
    if project_type in ("mixed_use_officetel", "neighborhood_house", "mixed_use_residential"):
        missing_inputs.append("주거/비주거 공용면적 구분 또는 배분 기준")

    return {
        "areaBasedUsesReady": has_general,
        "housingCalculationReady": has_housing and unit_summary.get("hasExplicitUnits"),
        "requiresHousingUnitInputs": has_housing,
        "missingInputs": missing_inputs,
        "needsInput": bool(missing_inputs),
    }


def build_building_program_summary(
    floor_plans: list[dict[str, Any]],
    model_settings: dict[str, Any] | None = None,
    building_use_taxonomy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    components = _program_area_components(floor_plans, model_settings, building_use_taxonomy)
    use_groups = _group_components(components)
    project_type, project_type_label = _infer_project_type(use_groups)
    declared_project_type = ((model_settings or {}).get("buildingProgram") or {}).get("declaredProjectType")
    if declared_project_type in PROJECT_TYPE_LABELS:
        project_type = declared_project_type
        project_type_label = PROJECT_TYPE_LABELS[project_type]
    unit_summary = _unit_summary(model_settings)
    common_allocation = _common_area_allocation(use_groups, model_settings)
    parking_readiness = _parking_readiness(project_type, use_groups, unit_summary, common_allocation)

    gross_area = sum(_float_value(component.get("areaM2")) for component in components)
    exclusive_area = sum(_float_value(group.get("exclusiveAreaM2")) for group in use_groups)
    common_area = sum(_float_value(group.get("commonAreaM2")) for group in use_groups)
    parking_area = sum(_float_value(group.get("parkingAreaM2")) for group in use_groups)

    return {
        "source": "building-program-model",
        "projectType": project_type,
        "projectTypeLabel": project_type_label,
        "declaredProjectType": declared_project_type,
        "classificationConfidence": "medium" if use_groups else "low",
        "areaSummary": {
            "grossAreaM2": _rounded(gross_area),
            "exclusiveAreaM2": _rounded(exclusive_area),
            "commonAreaM2": _rounded(common_area),
            "parkingAreaM2": _rounded(parking_area),
            "componentCount": len(components),
            "useGroupCount": len(use_groups),
        },
        "useGroups": use_groups,
        "areaComponents": components,
        "unitSummary": unit_summary,
        "commonAreaAllocation": common_allocation,
        "parkingReadiness": parking_readiness,
        "needsInput": bool(parking_readiness.get("needsInput")),
        "needsManualReview": True,
    }
