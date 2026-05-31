from typing import Any

from engine.regulation.ordinance_engine import collect_law_references
from engine.regulation.rules import ZONE_ALIASES, ZONE_RULES


def _law_context(parcel: dict[str, Any]) -> dict[str, Any]:
    try:
        return collect_law_references(parcel)
    except Exception as exc:
        return {
            "status": "error",
            "provider": "law-openapi",
            "lawReferences": [],
            "structuredRuleDrafts": [],
            "providerResponses": [],
            "needsManualReview": True,
            "message": f"법제처 조회 준비 중 오류가 발생해 fallback 규정표를 사용합니다: {exc}",
        }


def _source_context(law_context: dict[str, Any], calculation: str) -> dict[str, Any]:
    law_status = law_context.get("status")
    if law_status == "ok":
        return {
            "type": "hybrid",
            "status": "law-openapi-referenced",
            "label": "법제처 조회됨 + fallback 계산",
            "provider": law_context.get("provider"),
            "calculation": calculation,
        }
    return {
        "type": "fallback",
        "status": law_status or "fallback",
        "label": "fallback 기본 규정표 사용",
        "provider": law_context.get("provider"),
        "calculation": calculation,
    }


def _uncertainty_context(law_context: dict[str, Any], reasons: list[str]) -> dict[str, Any]:
    return {
        "level": "manual_review_required",
        "reasons": reasons,
        "lawLookupStatus": law_context.get("status"),
    }


def _match_zone_label(*labels: str | None) -> str | None:
    combined = " ".join(label for label in labels if label)
    if not combined:
        return None

    for alias, canonical in ZONE_ALIASES.items():
        if alias in combined:
            return canonical

    for zone_name in ZONE_RULES:
        if zone_name in combined:
            return zone_name

    return combined.strip()


def analyze_regulations(parcel: dict[str, Any]) -> dict[str, Any]:
    law_context = _law_context(parcel)
    land = parcel.get("land") or {}
    districts: list[str] = parcel.get("districts") or []
    area_raw = parcel.get("area_m2")
    area_m2 = float(area_raw) if area_raw is not None else 0.0

    zone_primary = land.get("zone_primary")
    zone_secondary = land.get("zone_secondary")
    district_label = districts[0] if districts else None

    zone_label = _match_zone_label(zone_primary, zone_secondary, district_label)
    has_zone = zone_label is not None and zone_label in ZONE_RULES

    notes: list[str] = list(parcel.get("warnings") or [])
    if law_context.get("message"):
        notes.append(str(law_context["message"]))
    elif law_context.get("status") == "ok":
        notes.append("법제처 Open API에서 법령/자치법규 후보를 조회했습니다.")

    if not has_zone:
        notes.append(
            "용도지역·건폐율·용적률은 토지특성 API 조회 결과가 있어야 표시됩니다. "
            "VWorld 인증키에 '국가중점데이터(토지특성)' 권한을 추가하세요."
        )
        return {
            "zone": {
                "primary": zone_primary,
                "secondary": zone_secondary,
                "districts": districts,
                "matched": zone_label or "조회 불가",
            },
            "limits": None,
            "computed": {
                "site_area_m2": area_m2,
                "max_building_area_m2": None,
                "max_gross_floor_area_m2": None,
            },
            "land": {
                "jimok": land.get("jimok"),
                "road_side": land.get("road_side"),
                "official_land_price": land.get("official_land_price"),
            },
            "notes": notes,
            "available": False,
            "source": _source_context(law_context, "zone-unavailable"),
            "lawReferences": law_context.get("lawReferences", []),
            "structuredRuleDrafts": law_context.get("structuredRuleDrafts", []),
            "jurisdiction": law_context.get("jurisdiction"),
            "needsManualReview": True,
            "uncertainty": _uncertainty_context(
                law_context,
                ["용도지역 또는 VWorld 토지특성 값이 없어 규모 계산을 확정할 수 없습니다."],
            ),
        }

    rule = ZONE_RULES[zone_label]
    bcr = float(rule["bcr"])
    far = float(rule["far"])
    max_height = rule.get("max_height_m")

    notes.append("건폐율·용적률 계산값은 기존 fallback 표 기준이며, 조례 원문 수치 확인이 필요합니다.")
    if parcel.get("geometry_source") == "approximate":
        notes.append("필지 경계가 근사치이므로 면적·체적도 참고용입니다.")
    if parcel.get("geometry_source") == "demo":
        notes.append("데모 모드(FAM_DEMO_MODE) 데이터입니다.")

    return {
        "zone": {
            "primary": zone_primary,
            "secondary": zone_secondary,
            "districts": districts,
            "matched": zone_label,
        },
        "limits": {
            "bcr_percent": bcr,
            "far_percent": far,
            "max_height_m": max_height,
        },
        "computed": {
            "site_area_m2": area_m2,
            "max_building_area_m2": round(area_m2 * bcr / 100, 2),
            "max_gross_floor_area_m2": round(area_m2 * far / 100, 2),
        },
        "land": {
            "jimok": land.get("jimok"),
            "road_side": land.get("road_side"),
            "official_land_price": land.get("official_land_price"),
        },
        "notes": notes,
        "available": True,
        "source": _source_context(law_context, "ZONE_RULES fallback table"),
        "lawReferences": law_context.get("lawReferences", []),
        "structuredRuleDrafts": law_context.get("structuredRuleDrafts", []),
        "jurisdiction": law_context.get("jurisdiction"),
        "needsManualReview": True,
        "uncertainty": _uncertainty_context(
            law_context,
            [
                "법제처 원문 조회 결과를 계산 규칙으로 완전 파싱하지 않았습니다.",
                "지자체 조례/별표 수치와 fallback 표의 일치 여부를 수동 확인해야 합니다.",
            ],
        ),
    }
