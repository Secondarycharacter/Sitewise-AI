"""Calculate required parking counts from parsed ordinance rule drafts."""

from __future__ import annotations

from math import ceil
from typing import Any

from engine.regulation.parking_area_model import normalize_parking_area_inputs


FACILITY_CATEGORY_KEYWORDS = {
    "entertainment": ("위락시설",),
    "assembly_area100": ("문화 및 집회시설", "종교시설", "운수시설", "의료시설", "운동시설", "장례식장"),
    "neighborhood_living": ("근린생활시설", "제1종근린생활시설", "제2종근린생활시설", "숙박시설"),
    "retail": ("판매시설",),
    "office": ("업무시설", "일반업무시설", "공공업무시설"),
    "detached_house": ("단독주택",),
    "housing_standard": ("다가구주택", "공동주택", "오피스텔"),
    "dormitory": ("학생용기숙사",),
    "education": ("학교시설", "학교"),
    "data_center": ("데이터센터",),
    "broadcasting": ("방송통신시설", "방송국"),
    "warehouse": ("창고시설",),
    "factory_training_power": ("공장", "발전시설", "수련시설"),
    "unit_based": ("골프장", "골프연습장", "옥외수영장", "관람장"),
    "other": ("그 밖의 건축물",),
}

USE_SPECIFIC_KEYWORDS = {
    "근린": ("근린생활시설", "제1종근린생활시설", "제2종근린생활시설"),
    "제1종": ("제1종근린생활시설",),
    "제2종": ("제2종근린생활시설",),
    "판매": ("판매시설",),
    "숙박": ("숙박시설",),
    "일반업무": ("일반업무시설",),
    "공공업무": ("공공업무시설",),
    "업무": ("업무시설",),
    "오피스텔": ("오피스텔",),
    "다가구": ("다가구주택",),
    "공동주택": ("공동주택",),
    "학교": ("학교시설", "학교"),
    "기숙사": ("학생용기숙사", "기숙사"),
    "데이터센터": ("데이터센터",),
    "창고": ("창고시설",),
    "공장": ("공장",),
}


def _use_search_text(area_input: dict[str, Any]) -> str:
    legal_use = area_input.get("legalUse") or {}
    return " ".join(
        str(value or "")
        for value in [
            area_input.get("use"),
            legal_use.get("categoryName"),
            legal_use.get("subcategory"),
            legal_use.get("matchedAlias"),
        ]
    )


def _rule_score(rule: dict[str, Any], area_input: dict[str, Any]) -> int:
    facility = str(rule.get("facility") or "")
    standard = str(rule.get("standard") or "")
    search_text = f"{facility} {standard}"
    category = area_input.get("category")
    score = 0
    for keyword in FACILITY_CATEGORY_KEYWORDS.get(str(category), ()):
        if keyword and keyword in facility:
            score += 10
    use_text = _use_search_text(area_input)
    for token, facility_keywords in USE_SPECIFIC_KEYWORDS.items():
        if token in use_text and any(keyword in search_text for keyword in facility_keywords):
            score += 8
    if use_text and use_text in search_text:
        score += 12
    if "그 밖의 건축물" in facility:
        score += 1
    return score


def _best_rule(rules: list[dict[str, Any]], area_input: dict[str, Any]) -> dict[str, Any] | None:
    candidates = [(rule, _rule_score(rule, area_input)) for rule in rules]
    candidates = [(rule, score) for rule, score in candidates if score > 0]
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[1], reverse=True)
    return candidates[0][0]


def _variant_divisor(calculation: dict[str, Any], use_text: str) -> tuple[float, str | None]:
    for variant in calculation.get("variants") or []:
        keywords = [str(keyword) for keyword in variant.get("keywords") or [] if keyword]
        if any(keyword in use_text for keyword in keywords):
            divisor = float(variant.get("divisorM2") or 0)
            if divisor > 0:
                return divisor, str(variant.get("label") or "")
    return float(calculation.get("divisorM2") or 0), None


def _calculate_count(area_m2: float, rule: dict[str, Any], area_input: dict[str, Any]) -> tuple[float, str]:
    calculation = rule.get("calculation") or {}
    method = calculation.get("method")

    if method == "area_per_car":
        divisor, variant_label = _variant_divisor(calculation, _use_search_text(area_input))
        if divisor > 0:
            label = f"{variant_label}: " if variant_label else ""
            return area_m2 / divisor, f"{label}{area_m2:.1f} / {divisor:.1f}"

    if method == "detached_house_piecewise":
        if area_m2 <= 50:
            return area_m2 / 100, f"{area_m2:.1f} / 100"
        if area_m2 <= 150:
            return 1.0, "1"
        threshold = float(calculation.get("thresholdM2") or 150)
        divisor = float(calculation.get("additionalDivisorM2") or 100)
        return 1 + max(0, area_m2 - threshold) / divisor, f"1 + ({area_m2:.1f} - {threshold:.1f}) / {divisor:.1f}"

    return 0.0, "수동확인"


def _is_external_standard_reference(rule: dict[str, Any]) -> bool:
    calculation = rule.get("calculation") or {}
    return calculation.get("method") == "external_standard_reference"


def _housing_program_detail(area_input: dict[str, Any], building_program: dict[str, Any] | None) -> dict[str, Any]:
    unit_summary = (building_program or {}).get("unitSummary") or {}
    common_allocation = (building_program or {}).get("commonAreaAllocation") or {}
    use_groups = (building_program or {}).get("useGroups") or []
    return {
        "projectType": (building_program or {}).get("projectType"),
        "projectTypeLabel": (building_program or {}).get("projectTypeLabel"),
        "unitCount": unit_summary.get("unitCount") or 0,
        "totalExclusiveAreaM2": unit_summary.get("totalExclusiveAreaM2")
        or unit_summary.get("unitExclusiveAreaM2")
        or 0,
        "units": unit_summary.get("units") or [],
        "commonAreaAllocation": common_allocation,
        "matchingUseGroups": [
            group
            for group in use_groups
            if group.get("parkingCategory") == area_input.get("category")
            or group.get("subcategory") == (area_input.get("legalUse") or {}).get("subcategory")
        ],
    }


def _external_standard_row(
    area_input: dict[str, Any],
    rule: dict[str, Any],
    building_program: dict[str, Any] | None,
) -> dict[str, Any]:
    calculation = rule.get("calculation") or {}
    housing_program = _housing_program_detail(area_input, building_program)
    has_unit_inputs = housing_program.get("unitCount", 0) > 0 and housing_program.get("totalExclusiveAreaM2", 0) > 0
    referenced_law = calculation.get("referencedLaw") or "외부 기준"
    formula = (
        f"{referenced_law} 원문 기준 산정 필요"
        if not has_unit_inputs
        else (
            f"{referenced_law} 원문 기준: "
            f"{housing_program['unitCount']}호/세대, 전용면적 합계 {housing_program['totalExclusiveAreaM2']}㎡"
        )
    )
    return {
        **area_input,
        "rule": {
            "number": rule.get("number"),
            "facility": rule.get("facility"),
            "standard": rule.get("standard"),
            "calculation": calculation,
        },
        "rawCount": None,
        "countForTotal": None,
        "requiredCount": None,
        "formula": formula,
        "housingProgram": housing_program,
        "needsInput": not has_unit_inputs,
        "needsManualReview": True,
        "unresolvedReason": (
            "세대·호실별 전용면적 입력이 필요합니다."
            if not has_unit_inputs
            else f"{referenced_law} 세부 산정식 원문 연결이 필요합니다."
        ),
    }


def _round_required_count(raw_count: float, rounding_rule: str | None) -> int:
    if raw_count <= 0:
        return 0
    if rounding_rule and "0.5 이상" in rounding_rule:
        integer = int(raw_count)
        return integer + 1 if raw_count - integer >= 0.5 else integer
    return ceil(raw_count)


def _round_for_mixed_use_sum(raw_count: float, decimal_places: int | None) -> float:
    if decimal_places is None:
        return raw_count
    return round(raw_count, int(decimal_places))


def calculate_parking_requirements(
    floor_plans: list[dict[str, Any]],
    parking_rule_tables: list[dict[str, Any]],
    building_use_taxonomy: dict[str, Any] | None = None,
    building_program: dict[str, Any] | None = None,
) -> dict[str, Any]:
    area_inputs = normalize_parking_area_inputs(floor_plans, building_use_taxonomy)
    rule_table = parking_rule_tables[0] if parking_rule_tables else None
    rules = list((rule_table or {}).get("rules") or [])
    application_rules = dict((rule_table or {}).get("applicationRules") or {})
    rounding_rule = application_rules.get("roundingRule")
    mixed_use_decimal_places = application_rules.get("mixedUseRoundToDecimalPlaces")
    taxonomy_status = (building_use_taxonomy or {}).get("status") or "missing"
    taxonomy_authoritative = taxonomy_status == "parsed"

    if not rules:
        return {
            "available": False,
            "requiredCount": None,
            "rawCount": None,
            "areaInputs": area_inputs,
            "rows": [],
            "source": (rule_table or {}).get("source") or {},
            "buildingUseTaxonomyStatus": taxonomy_status,
            "buildingUseTaxonomyAuthoritative": taxonomy_authoritative,
            "needsManualReview": True,
            "message": "계산 가능한 주차장 별표 규칙이 없어 주차대수를 산정하지 못했습니다.",
        }

    rows: list[dict[str, Any]] = []
    raw_total = 0.0
    unresolved_required_rows = False
    for area_input in area_inputs:
        if area_input.get("excluded"):
            rows.append(
                {
                    **area_input,
                    "rule": None,
                    "rawCount": 0.0,
                    "requiredCount": 0,
                    "formula": area_input.get("excludeReason"),
                    "needsManualReview": False,
                }
            )
            continue

        rule = _best_rule(rules, area_input)
        if not rule:
            unresolved_required_rows = True
            rows.append(
                {
                    **area_input,
                    "rule": None,
                    "rawCount": 0.0,
                    "requiredCount": None,
                    "formula": "매칭 규칙 없음",
                    "needsManualReview": True,
                }
            )
            continue

        legal_use = area_input.get("legalUse") or {}
        legal_use_needs_review = bool(legal_use.get("needsManualReview")) or not bool(legal_use.get("authoritative"))
        if _is_external_standard_reference(rule):
            unresolved_required_rows = True
            rows.append(_external_standard_row(area_input, rule, building_program))
            continue
        raw_count, formula = _calculate_count(float(area_input.get("includedAreaM2") or 0), rule, area_input)
        count_for_sum = _round_for_mixed_use_sum(raw_count, mixed_use_decimal_places)
        raw_total += count_for_sum
        rows.append(
            {
                **area_input,
                "rule": {
                    "number": rule.get("number"),
                    "facility": rule.get("facility"),
                    "standard": rule.get("standard"),
                    "calculation": rule.get("calculation"),
                },
                "rawCount": round(raw_count, 3),
                "countForTotal": round(count_for_sum, 3),
                "requiredCount": _round_required_count(raw_count, rounding_rule),
                "formula": formula,
                "needsManualReview": bool(rule.get("needsManualReview")) or legal_use_needs_review,
            }
        )

    needs_manual_review = any(row.get("needsManualReview") for row in rows) or not taxonomy_authoritative
    message = "주차대수 산정은 별표 파싱 초안 기준이며 최종 인허가 전 수동확인이 필요합니다."
    if not taxonomy_authoritative:
        message = "건축물 용도 분류 원문(API) 확인 전이므로 주차대수 산정은 후보값이며 수동확인이 필요합니다."
    if unresolved_required_rows:
        message = "주택/오피스텔 등 외부 기준 참조 항목이 있어 전체 법정주차대수는 아직 확정할 수 없습니다."
    partial_required_count = _round_required_count(raw_total, rounding_rule) if raw_total > 0 else None

    return {
        "available": not unresolved_required_rows,
        "requiredCount": None if unresolved_required_rows else _round_required_count(raw_total, rounding_rule),
        "partialRequiredCount": partial_required_count if unresolved_required_rows else None,
        "rawCount": round(raw_total, 3),
        "areaInputs": area_inputs,
        "rows": rows,
        "source": rule_table.get("source") if rule_table else {},
        "buildingUseTaxonomyStatus": taxonomy_status,
        "buildingUseTaxonomyAuthoritative": taxonomy_authoritative,
        "applicationRules": application_rules,
        "needsManualReview": needs_manual_review,
        "unresolvedRequiredRows": unresolved_required_rows,
        "message": message,
    }
