"""Automatic site-specific compliance checklist.

This engine does not ask the user for law articles. It generates checks from the
parcel, planning data, collected ordinance sources, and calculation results.
"""

from __future__ import annotations

from typing import Any

from engine.regulation.accessible_parking_engine import build_accessible_parking_detail
from engine.regulation.compliance_evidence_planner import attach_evidence_plans
from engine.regulation.parking_exception_engine import build_parking_exception_detail

CHECK_PASS = "pass"
CHECK_FAIL = "fail"
CHECK_NEEDS_REVIEW = "needs_review"
CHECK_NEEDS_INPUT = "needs_input"
CHECK_DATA_MISSING = "data_missing"
CHECK_NOT_APPLICABLE = "not_applicable"


def _float_value(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if number > 0 else 0.0


def _positive_number(value: Any) -> float | None:
    number = _float_value(value)
    return number if number > 0 else None


def _check(
    key: str,
    label: str,
    category: str,
    status: str,
    summary: str,
    basis: list[str] | None = None,
    details: dict[str, Any] | None = None,
    blocking_checks: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "category": category,
        "status": status,
        "summary": summary,
        "basis": basis or [],
        "details": details or {},
        "blockingChecks": blocking_checks or [],
    }


def _floor_metrics(floor_plans: list[dict[str, Any]]) -> dict[str, float]:
    above = [plan for plan in floor_plans or [] if plan.get("type") == "above"]
    return {
        "buildingAreaM2": max([_float_value(plan.get("areaM2")) for plan in above] or [0.0]),
        "farFloorAreaM2": sum(_float_value(plan.get("areaM2")) for plan in above),
        "grossFloorAreaM2": sum(_float_value(plan.get("areaM2")) for plan in floor_plans or []),
        "maxHeightM": max([_float_value(plan.get("zMax")) for plan in above] or [0.0]),
    }


def _coverage_check(regulations: dict[str, Any], floor_plans: list[dict[str, Any]]) -> dict[str, Any]:
    limits = regulations.get("limits") or {}
    computed = regulations.get("computed") or {}
    site_area = _float_value(computed.get("site_area_m2"))
    bcr_limit = _float_value(limits.get("bcr_percent"))
    building_area = _floor_metrics(floor_plans)["buildingAreaM2"]

    if site_area <= 0 or bcr_limit <= 0 or building_area <= 0:
        return _check(
            "building_coverage",
            "건폐율",
            "규모",
            CHECK_DATA_MISSING,
            "건폐율 자동 검토에 필요한 대지면적/건축면적/한계값이 부족합니다.",
        )

    actual = building_area / site_area * 100
    status = CHECK_PASS if actual <= bcr_limit + 0.01 else CHECK_FAIL
    return _check(
        "building_coverage",
        "건폐율",
        "규모",
        status,
        f"계획 건폐율 {actual:.2f}% / 기준 {bcr_limit:.2f}%",
        basis=["용도지역 건폐율 기준", "지자체 도시계획 조례 수동확인 필요"],
        details={
            "siteAreaM2": round(site_area, 2),
            "buildingAreaM2": round(building_area, 2),
            "actualPercent": round(actual, 2),
            "limitPercent": round(bcr_limit, 2),
        },
    )


def _far_check(regulations: dict[str, Any], floor_plans: list[dict[str, Any]]) -> dict[str, Any]:
    limits = regulations.get("limits") or {}
    computed = regulations.get("computed") or {}
    site_area = _float_value(computed.get("site_area_m2"))
    far_limit = _float_value(limits.get("far_percent"))
    far_area = _floor_metrics(floor_plans)["farFloorAreaM2"]

    if site_area <= 0 or far_limit <= 0 or far_area <= 0:
        return _check(
            "floor_area_ratio",
            "용적률",
            "규모",
            CHECK_DATA_MISSING,
            "용적률 자동 검토에 필요한 대지면적/용적률 산정면적/한계값이 부족합니다.",
        )

    actual = far_area / site_area * 100
    status = CHECK_PASS if actual <= far_limit + 0.01 else CHECK_FAIL
    return _check(
        "floor_area_ratio",
        "용적률",
        "규모",
        status,
        f"계획 용적률 {actual:.2f}% / 기준 {far_limit:.2f}%",
        basis=["용도지역 용적률 기준", "지자체 도시계획 조례 수동확인 필요"],
        details={
            "siteAreaM2": round(site_area, 2),
            "farFloorAreaM2": round(far_area, 2),
            "actualPercent": round(actual, 2),
            "limitPercent": round(far_limit, 2),
        },
    )


def _height_limit_check(regulations: dict[str, Any], floor_plans: list[dict[str, Any]]) -> dict[str, Any]:
    limits = regulations.get("limits") or {}
    height_limit = _float_value(limits.get("max_height_m"))
    planned_height = _floor_metrics(floor_plans)["maxHeightM"]

    if height_limit <= 0:
        return _check(
            "height_limit",
            "높이 제한",
            "규모",
            CHECK_NEEDS_INPUT,
            "지구단위계획 또는 관련 기준의 최종 높이 제한값을 수동 입력해야 합니다.",
            blocking_checks=["지구단위계획 시행지침 높이 기준", "획지별 최고높이/층수 기준"],
        )

    if planned_height <= 0:
        return _check(
            "height_limit",
            "높이 제한",
            "규모",
            CHECK_DATA_MISSING,
            "높이 제한 검토에 필요한 계획 높이 데이터가 부족합니다.",
        )

    status = CHECK_PASS if planned_height <= height_limit + 0.01 else CHECK_FAIL
    return _check(
        "height_limit",
        "높이 제한",
        "규모",
        status,
        f"계획 높이 {planned_height:.2f}m / 기준 {height_limit:.2f}m",
        basis=["지구단위계획/용도지역 높이 기준 수동 입력값"],
        details={
            "plannedHeightM": round(planned_height, 2),
            "limitHeightM": round(height_limit, 2),
        },
    )


def _district_plan_density_check(regulations: dict[str, Any]) -> dict[str, Any]:
    district_plan = regulations.get("districtPlan") or {}
    if not district_plan.get("detected"):
        return _check(
            "district_plan_density_modifier",
            "지구단위계획 규모 보정",
            "규모",
            CHECK_NOT_APPLICABLE,
            "지구단위계획구역이 감지되지 않아 별도 규모 보정 검토 대상이 아닙니다.",
            details=district_plan,
        )

    return _check(
        "district_plan_density_modifier",
        "지구단위계획 규모 보정",
        "규모",
        CHECK_NEEDS_REVIEW,
        district_plan.get("summary")
        or "지구단위계획구역의 건폐율/용적률 별도 기준 확인이 필요합니다.",
        basis=district_plan.get("districts") or [],
        details=district_plan,
        blocking_checks=[
            "토지이음 지구단위계획구역 행위제한내용",
            "지구단위계획 결정도서/시행지침",
            "건폐율/용적률 인센티브 또는 상한 규정",
        ],
    )


def _land_use_restriction_check(parcel: dict[str, Any], regulations: dict[str, Any]) -> dict[str, Any]:
    eum = regulations.get("eum") or {}
    eum_status = eum.get("status")
    if eum_status == "api-indexed":
        return _check(
            "land_use_restrictions",
            "토지이용/행위제한",
            "대지",
            CHECK_NEEDS_REVIEW,
            "토지이용규제정보서비스 응답을 수집했으며 계획 용도와의 대조가 필요합니다.",
            basis=[item.get("summary") for item in eum.get("restrictionItems", []) if item.get("summary")],
            details=eum,
            blocking_checks=["계획 용도와 행위제한 가능여부 매칭"],
        )

    zone = regulations.get("zone") or {}
    districts = zone.get("districts") or parcel.get("districts") or []
    matched = zone.get("matched")
    if not matched and not districts:
        return _check(
            "land_use_restrictions",
            "토지이용/행위제한",
            "대지",
            CHECK_DATA_MISSING,
            "토지이용계획 및 행위제한내용 데이터가 없어 용도 가능성을 자동 확정할 수 없습니다.",
            blocking_checks=["토지이음 행위제한내용", "행위제한내용 설명"],
        )

    return _check(
        "land_use_restrictions",
        "토지이용/행위제한",
        "대지",
        CHECK_NEEDS_REVIEW,
        "용도지역/지구 후보는 확인됐지만 토지이음 행위제한내용 원문 대조가 필요합니다.",
        basis=[value for value in [matched, *districts] if value],
        details={"zone": matched, "districts": districts, "eum": eum},
        blocking_checks=["토지이음 지역·지구 등 안에서의 행위제한내용", "행위제한내용 설명"],
    )


def _law_evidence_check(regulations: dict[str, Any]) -> dict[str, Any]:
    status = regulations.get("lawDocumentStatus") or {}
    indexed = int(status.get("indexed") or 0)
    appendix_indexed = int(status.get("appendixIndexed") or 0)
    if indexed <= 0:
        return _check(
            "law_evidence",
            "법규 원문/별표 근거",
            "법규출처",
            CHECK_DATA_MISSING,
            "법제처/국가법령정보센터 원문 색인 결과가 없어 fallback 기준만 사용할 수 있습니다.",
        )

    return _check(
        "law_evidence",
        "법규 원문/별표 근거",
        "법규출처",
        CHECK_NEEDS_REVIEW if appendix_indexed <= 0 else CHECK_PASS,
        f"법규 문서 {indexed}개 색인, 별표 {appendix_indexed}개 색인",
        details=status,
    )


def _parking_check(regulations: dict[str, Any], model_settings: dict[str, Any] | None) -> dict[str, Any]:
    parking = regulations.get("parkingCalculation") or {}
    if not parking:
        return _check(
            "parking_required_count",
            "부설주차장 필요대수",
            "주차",
            CHECK_DATA_MISSING,
            "주차대수 산정 결과가 아직 생성되지 않았습니다.",
        )

    if not parking.get("available"):
        return _check(
            "parking_required_count",
            "부설주차장 필요대수",
            "주차",
            CHECK_NEEDS_REVIEW,
            parking.get("message") or "계산 가능한 주차 규칙이 없습니다.",
            details=parking,
        )

    required_count = parking.get("requiredCount")
    planned_count = _positive_number((model_settings or {}).get("parkingCount"))
    if planned_count is None:
        return _check(
            "parking_required_count",
            "부설주차장 필요대수",
            "주차",
            CHECK_NEEDS_INPUT,
            f"법규 기준 필요 주차대수는 {required_count}대입니다. 계획 주차대수 입력이 필요합니다.",
            basis=["주차장 조례 별표 산정 기준"],
            details=parking,
            blocking_checks=["주차장 설치제한구역 여부", "장애인/전기차/경형 등 추가 의무"],
        )

    required_number = float(required_count or 0)
    shortage = max(0.0, required_number - planned_count)
    if planned_count < required_number:
        status = CHECK_FAIL
    elif parking.get("needsManualReview"):
        status = CHECK_NEEDS_REVIEW
    else:
        status = CHECK_PASS
    review_note = " 산정근거 수동확인이 남아 있습니다." if status == CHECK_NEEDS_REVIEW else ""
    return _check(
        "parking_required_count",
        "부설주차장 필요대수",
        "주차",
        status,
        f"계획 {planned_count:g}대 / 필요 {required_count}대.{review_note}".strip(),
        basis=["주차장 조례 별표 산정 기준"],
        details={**parking, "plannedCount": planned_count, "shortageCount": round(shortage, 3)},
        blocking_checks=["주차장 설치제한구역 여부", "장애인/전기차/경형 등 추가 의무"],
    )


def _known_deferred_checks(
    parcel: dict[str, Any],
    regulations: dict[str, Any],
    model_settings: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    parking_calculation = regulations.get("parkingCalculation") or {}
    parking_exception_detail = build_parking_exception_detail(
        parcel,
        regulations,
        parking_calculation,
    )
    accessible_detail = build_accessible_parking_detail(parking_calculation, model_settings)

    return [
        _check(
            "parking_restricted_area",
            "주차장 설치제한구역/예외",
            "주차",
            CHECK_NEEDS_REVIEW,
            parking_exception_detail["summary"],
            details=parking_exception_detail,
            blocking_checks=["서울특별시 주차장 설치 및 관리 조례 제21조 및 별표 3"],
        ),
        _check(
            "accessible_parking",
            "장애인전용주차구획",
            "주차",
            CHECK_NEEDS_REVIEW,
            accessible_detail["reason"],
            details=accessible_detail,
            blocking_checks=["장애인등편의법", "서울시 조례 장애인전용주차구획 조항"],
        ),
        _check(
            "landscape_requirement",
            "조경 의무",
            "조경",
            CHECK_NEEDS_REVIEW,
            "조경 기준은 건축조례 본문/별표를 수집해 별도 산정 엔진으로 판단해야 합니다.",
            blocking_checks=["건축법", "서울특별시 건축 조례 조경 기준"],
        ),
        _check(
            "setback_requirement",
            "대지안의 공지",
            "배치",
            CHECK_NEEDS_REVIEW,
            "현재 이격거리 표시는 참고값이며 건축조례 본문/별표 원문 대조가 필요합니다.",
            blocking_checks=["서울특별시 건축 조례 대지안의 공지"],
        ),
    ]


def build_site_compliance_checklist(
    parcel: dict[str, Any],
    regulations: dict[str, Any],
    floor_plans: list[dict[str, Any]],
    model_settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    checks = [
        _land_use_restriction_check(parcel, regulations),
        _law_evidence_check(regulations),
        _coverage_check(regulations, floor_plans),
        _far_check(regulations, floor_plans),
        _height_limit_check(regulations, floor_plans),
        _district_plan_density_check(regulations),
        _parking_check(regulations, model_settings),
        *_known_deferred_checks(parcel, regulations, model_settings),
    ]
    checks, evidence_collection_plan = attach_evidence_plans(checks)

    counts: dict[str, int] = {}
    for check in checks:
        counts[check["status"]] = counts.get(check["status"], 0) + 1

    blocking_checks = []
    for check in checks:
        blocking_checks.extend(check.get("blockingChecks") or [])

    return {
        "statusCounts": counts,
        "checks": checks,
        "evidenceCollectionPlan": evidence_collection_plan,
        "blockingChecks": list(dict.fromkeys(blocking_checks)),
        "needsManualReview": any(
            check["status"] in (CHECK_NEEDS_REVIEW, CHECK_NEEDS_INPUT, CHECK_DATA_MISSING)
            for check in checks
        ),
        "summary": "대지/계획/법규 데이터 기반 자동 체크리스트입니다. 토지이음 행위제한 및 일부 특수 규정은 추가 연동 후 확정 가능합니다.",
    }
