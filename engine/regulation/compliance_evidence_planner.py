"""Plan automatic evidence collection for unresolved compliance checks."""

from __future__ import annotations

from typing import Any


EVIDENCE_TEMPLATES = {
    "land_use_restrictions": [
        {
            "source": "토지이음",
            "target": "land_use_restriction",
            "label": "지역·지구 등 안에서의 행위제한내용",
            "required": True,
        },
        {
            "source": "토지이음",
            "target": "land_use_restriction_description",
            "label": "행위제한내용 설명",
            "required": True,
        },
        {
            "source": "공공데이터포털",
            "target": "토지이용규제정보서비스",
            "query": "pnu",
            "label": "토지이용행위 가능여부",
            "required": True,
        },
        {
            "source": "공공데이터포털",
            "target": "토지이용규제법령정보서비스",
            "query": "지역지구 법령/조례 조항",
            "label": "행위제한 관련 조항",
            "required": True,
        },
        {
            "source": "공공데이터포털",
            "target": "규제안내서서비스",
            "query": "건축 인허가 안내",
            "label": "계획/건축 인허가 단계별 안내",
            "required": False,
        },
    ],
    "building_coverage": [
        {
            "source": "법제처",
            "target": "ordin",
            "query": "도시계획 조례 건폐율",
            "label": "지자체 도시계획 조례 건폐율 조항",
            "required": True,
        },
        {
            "source": "법제처",
            "target": "licbyl",
            "query": "용도지역별 건폐율",
            "label": "건폐율 관련 별표",
            "required": False,
        },
    ],
    "floor_area_ratio": [
        {
            "source": "법제처",
            "target": "ordin",
            "query": "도시계획 조례 용적률",
            "label": "지자체 도시계획 조례 용적률 조항",
            "required": True,
        },
        {
            "source": "법제처",
            "target": "licbyl",
            "query": "용도지역별 용적률",
            "label": "용적률 관련 별표",
            "required": False,
        },
    ],
    "height_limit": [
        {
            "source": "지구단위계획 결정도서/시행지침",
            "target": "uploaded_district_plan_document",
            "query": "높이 최고높이 층수",
            "label": "획지별 높이/층수 기준",
            "required": True,
        },
        {
            "source": "설계입력",
            "target": "manual_height_limit",
            "label": "최종 적용 높이 제한 수동 입력값",
            "required": True,
        },
    ],
    "district_plan_density_modifier": [
        {
            "source": "토지이음",
            "target": "district_unit_plan_restriction",
            "label": "지구단위계획구역 행위제한내용/설명",
            "required": True,
        },
        {
            "source": "공공데이터포털",
            "target": "토지이용규제법령정보서비스",
            "query": "지구단위계획구역 건폐율 용적률",
            "label": "지구단위계획구역 규모 관련 조항",
            "required": True,
        },
        {
            "source": "지자체 고시/도시계획정보",
            "target": "district_unit_plan_notice",
            "query": "지구단위계획 결정도서 시행지침",
            "label": "지구단위계획 결정도서/시행지침",
            "required": True,
        },
    ],
    "parking_required_count": [
        {
            "source": "법제처",
            "target": "ordin",
            "query": "주차장 설치 및 관리 조례 부설주차장 설치기준",
            "label": "부설주차장 설치기준 본문",
            "required": True,
        },
        {
            "source": "법제처",
            "target": "licbyl",
            "query": "부설주차장의 설치대상 시설물 종류 및 설치기준",
            "label": "부설주차장 설치기준 별표",
            "required": True,
        },
    ],
    "parking_restricted_area": [
        {
            "source": "법제처",
            "target": "ordin",
            "query": "주차장 설치제한 지역 설치제한 기준",
            "label": "부설주차장 설치제한구역 본문",
            "required": True,
        },
        {
            "source": "법제처",
            "target": "licbyl",
            "query": "부설주차장의 설치제한 지역에서의 시설물의 종류별 설치기준",
            "label": "설치제한 지역 별표",
            "required": True,
        },
        {
            "source": "토지이음",
            "target": "district_overlay",
            "label": "대지가 설치제한구역 또는 관련 지구에 포함되는지 여부",
            "required": True,
        },
    ],
    "accessible_parking": [
        {
            "source": "법제처",
            "target": "law",
            "query": "장애인 노인 임산부 등의 편의증진 보장에 관한 법률 장애인전용주차구역",
            "label": "장애인전용주차구역 상위 법령",
            "required": True,
        },
        {
            "source": "법제처",
            "target": "ordin",
            "query": "주차장 설치 및 관리 조례 장애인전용주차구획",
            "label": "지자체 장애인전용주차구획 조례",
            "required": True,
        },
        {
            "source": "설계입력",
            "target": "planned_parking_count",
            "label": "최종 계획 주차대수",
            "required": True,
        },
    ],
    "landscape_requirement": [
        {
            "source": "법제처",
            "target": "ordin",
            "query": "건축 조례 대지의 조경",
            "label": "대지의 조경 조례 본문",
            "required": True,
        },
        {
            "source": "법제처",
            "target": "licbyl",
            "query": "조경 식재 기준 별표",
            "label": "조경/식재 기준 별표",
            "required": False,
        },
    ],
    "setback_requirement": [
        {
            "source": "법제처",
            "target": "ordin",
            "query": "건축 조례 대지안의 공지",
            "label": "대지안의 공지 조례 본문",
            "required": True,
        },
        {
            "source": "법제처",
            "target": "licbyl",
            "query": "대지안의 공지 이격거리 별표",
            "label": "대지안의 공지 이격거리 별표",
            "required": False,
        },
    ],
}


def evidence_plan_for_check(check: dict[str, Any]) -> list[dict[str, Any]]:
    if check.get("status") == "not_applicable":
        return []
    templates = EVIDENCE_TEMPLATES.get(str(check.get("key")) or "", [])
    basis = set(check.get("basis") or [])
    planned = []
    for template in templates:
        label = str(template.get("label") or "")
        planned.append(
            {
                **template,
                "status": "already_available"
                if any(label and label in str(item) for item in basis)
                else "pending",
            }
        )
    return planned


def attach_evidence_plans(checks: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    enriched: list[dict[str, Any]] = []
    collection_plan: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()

    for check in checks:
        plan = evidence_plan_for_check(check)
        enriched_check = {**check, "evidencePlan": plan}
        enriched.append(enriched_check)
        for item in plan:
            if item.get("status") == "already_available":
                continue
            key = (
                str(item.get("source") or ""),
                str(item.get("target") or ""),
                str(item.get("query") or item.get("label") or ""),
            )
            if key in seen:
                continue
            seen.add(key)
            collection_plan.append(
                {
                    **item,
                    "reason": check.get("label"),
                    "checkKey": check.get("key"),
                }
            )

    return enriched, collection_plan
