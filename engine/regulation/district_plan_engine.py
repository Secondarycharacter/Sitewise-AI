"""Detect district-unit-plan effects on density controls."""

from __future__ import annotations

from typing import Any

DISTRICT_PLAN_KEYWORDS = ("지구단위계획", "지구단위계획구역")
DENSITY_KEYWORDS = ("건폐율", "용적률", "완화", "상한", "인센티브", "허용용적률")


def _contains_any(text: str, keywords: tuple[str, ...]) -> bool:
    return any(keyword in text for keyword in keywords)


def _flatten(value: Any) -> list[str]:
    if isinstance(value, dict):
        values: list[str] = []
        for nested in value.values():
            values.extend(_flatten(nested))
        return values
    if isinstance(value, list):
        values = []
        for item in value:
            values.extend(_flatten(item))
        return values
    text = str(value or "").strip()
    return [text] if text else []


def build_district_plan_context(
    parcel: dict[str, Any],
    regulations: dict[str, Any],
    eum_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    districts = []
    for source in (
        (parcel.get("districts") or []),
        ((regulations.get("zone") or {}).get("districts") or []),
    ):
        for district in source:
            text = str(district or "").strip()
            if text and text not in districts:
                districts.append(text)

    for entry in (eum_context or {}).get("districts") or []:
        text = str(entry.get("name") or "").strip()
        if text and text not in districts:
            districts.append(text)

    has_district_plan = any(_contains_any(district, DISTRICT_PLAN_KEYWORDS) for district in districts)
    raw_eum_text = "\n".join(_flatten((eum_context or {}).get("apiResponse", {}).get("raw")))
    has_density_hint = _contains_any(raw_eum_text, DENSITY_KEYWORDS)
    limits = regulations.get("limits") or {}

    return {
        "detected": has_district_plan,
        "status": "modifier-evidence-required" if has_district_plan else "not-detected",
        "districts": [district for district in districts if _contains_any(district, DISTRICT_PLAN_KEYWORDS)],
        "baseLimits": {
            "bcrPercent": limits.get("bcr_percent"),
            "farPercent": limits.get("far_percent"),
            "source": "용도지역 fallback/조례 후보 기준",
        },
        "effectiveLimits": {
            "bcrPercent": limits.get("bcr_percent"),
            "farPercent": limits.get("far_percent"),
            "source": "지구단위계획 보정값 미확인 - 기본 기준 임시 적용",
        },
        "canRaiseLimits": True if has_district_plan else False,
        "hasDensityHintInEum": has_density_hint,
        "needsManualReview": has_district_plan,
        "summary": (
            "지구단위계획구역이 감지되어 건폐율/용적률 상향 또는 별도 기준 가능성을 확인해야 합니다."
            if has_district_plan
            else "지구단위계획구역이 감지되지 않았습니다."
        ),
        "evidencePlan": [
            {
                "source": "토지이음",
                "target": "district_unit_plan_restriction",
                "label": "지구단위계획구역 행위제한내용/설명",
                "required": True,
                "status": "pending" if has_district_plan else "not_applicable",
            },
            {
                "source": "공공데이터포털",
                "target": "토지이용규제법령정보서비스",
                "query": "지구단위계획구역 건폐율 용적률",
                "label": "지구단위계획구역 규모 관련 조항",
                "required": True,
                "status": "pending" if has_district_plan else "not_applicable",
            },
            {
                "source": "지자체 고시/도시계획정보",
                "target": "district_unit_plan_notice",
                "label": "해당 구역 지구단위계획 결정도서/시행지침",
                "required": True,
                "status": "pending" if has_district_plan else "not_applicable",
            },
        ],
    }
