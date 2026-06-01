"""Normalize planned floor areas for parking requirement calculations."""

from __future__ import annotations

from typing import Any

from engine.regulation.building_use_classifier import classify_building_use

PARKING_EXCLUDED_KEYWORDS = ("주차", "parking", "조경", "landscape", "공용", "복도", "코어")


def _float_value(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if number > 0 else 0.0


def _use_category(use: str, building_use_taxonomy: dict[str, Any] | None = None) -> str:
    legal_use = classify_building_use(use, building_use_taxonomy)
    if legal_use.get("parkingCategory"):
        return str(legal_use["parkingCategory"])

    text = use.lower()
    if any(keyword in text for keyword in ("위락",)):
        return "entertainment"
    if any(keyword in text for keyword in ("판매", "소매")):
        return "retail"
    if any(keyword in text for keyword in ("근린", "상가", "숙박")):
        return "neighborhood_living"
    if any(keyword in text for keyword in ("업무", "사무", "오피스")):
        return "office"
    if any(keyword in text for keyword in ("주택", "주거", "공동주택", "다가구", "오피스텔")):
        return "residential"
    if any(keyword in text for keyword in ("창고",)):
        return "warehouse"
    if any(keyword in text for keyword in ("공장", "발전")):
        return "factory"
    return "other"


def _should_exclude(use: str) -> bool:
    text = use.lower()
    return any(keyword in text for keyword in PARKING_EXCLUDED_KEYWORDS)


def normalize_parking_area_inputs(
    floor_plans: list[dict[str, Any]],
    building_use_taxonomy: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    inputs: list[dict[str, Any]] = []
    for plan in floor_plans or []:
        use = str(plan.get("use") or "").strip() or "그 밖의 건축물"
        area_m2 = _float_value(plan.get("areaM2"))
        excluded = _should_exclude(use)
        legal_use = classify_building_use(use, building_use_taxonomy)
        inputs.append(
            {
                "floorId": plan.get("id"),
                "floorLabel": plan.get("label"),
                "floorType": plan.get("type"),
                "use": use,
                "category": str(legal_use.get("parkingCategory") or _use_category(use, building_use_taxonomy)),
                "legalUse": legal_use,
                "areaM2": area_m2,
                "includedAreaM2": 0.0 if excluded else area_m2,
                "excluded": excluded,
                "excludeReason": "주차/조경/공용 성격 면적은 주차 산정 입력에서 제외" if excluded else None,
            }
        )
    return inputs
