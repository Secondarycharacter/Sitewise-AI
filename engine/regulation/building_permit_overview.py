"""Seumteo/Building HUB compatible building permit overview draft.

The public Building HUB permit APIs expose the same broad sections architects
fill in Seumteo: basic overview, site location, zoning, building/dong overview,
floor overview, unit overview, area splits, and parking.  This module maps the
current generated model and regulation analysis into that sectioned structure.
It is intentionally export-ready in shape, but not a claim that Seumteo accepts
this exact payload as an upload format.
"""

from __future__ import annotations

import re
from typing import Any


BUILDING_HUB_SECTION_SCHEMAS = {
    "basicOverview": [
        ("platPlc", "대지위치"),
        ("sigunguCd", "시군구코드"),
        ("bjdongCd", "법정동코드"),
        ("platGbCd", "대지구분코드"),
        ("bun", "번"),
        ("ji", "지"),
        ("mgmPmsrgstPk", "관리허가대장관리번호"),
        ("bldNm", "건물명"),
        ("jimokNm", "지목명"),
        ("mainPurpsCdNm", "주용도명"),
        ("platArea", "대지면적"),
        ("archArea", "건축면적"),
        ("bcRat", "건폐율"),
        ("totArea", "연면적"),
        ("vlRatEstmTotArea", "용적률산정연면적"),
        ("vlRat", "용적률"),
        ("mainBldCnt", "주건축물수"),
        ("atchBldDongCnt", "부속건축물동수"),
        ("hhldCnt", "세대수"),
        ("hoCnt", "호수"),
        ("fmlyCnt", "가구수"),
        ("totPkngCnt", "총주차수"),
    ],
    "dongOverview": [
        ("dongNm", "동명칭"),
        ("mainPurpsCdNm", "주용도명"),
        ("mainStrctCdNm", "주구조명"),
        ("grndFlrCnt", "지상층수"),
        ("ugrndFlrCnt", "지하층수"),
        ("heit", "높이"),
        ("archArea", "건축면적"),
        ("totArea", "연면적"),
    ],
    "floorOverview": [
        ("dongNm", "동명칭"),
        ("flrGbCdNm", "층구분명"),
        ("flrNo", "층번호"),
        ("flrNoNm", "층명"),
        ("mainPurpsCdNm", "주용도명"),
        ("area", "면적"),
        ("exposPubuseArea", "전용면적"),
        ("pubuseArea", "공용면적"),
    ],
    "unitOverview": [
        ("dongNm", "동명칭"),
        ("hoNm", "호명칭"),
        ("mainPurpsCdNm", "주용도명"),
        ("unitCnt", "호/세대수"),
        ("exposPubuseArea", "전용면적"),
    ],
    "parking": [
        ("totPkngCnt", "총주차수"),
        ("indrMechUtcnt", "옥내기계식대수"),
        ("indrAutoUtcnt", "옥내자주식대수"),
        ("oudrMechUtcnt", "옥외기계식대수"),
        ("oudrAutoUtcnt", "옥외자주식대수"),
        ("requiredPkngCnt", "법정주차수"),
        ("plannedPkngCnt", "계획주차수"),
    ],
    "zoningDistrict": [
        ("zoneNm", "용도지역명"),
        ("districtNm", "용도지구명"),
        ("areaNm", "용도구역명"),
    ],
}


def _float_value(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if number > 0 else 0.0


def _int_value(value: Any) -> int:
    return int(round(_float_value(value)))


def _rounded(value: Any, digits: int = 3) -> float:
    return round(_float_value(value), digits)


def _text(value: Any, fallback: str = "") -> str:
    text = str(value or "").strip()
    return text or fallback


def _pnu_parts(pnu: Any) -> dict[str, str]:
    text = re.sub(r"\D", "", str(pnu or ""))
    if len(text) < 19:
        return {"sigunguCd": "", "bjdongCd": "", "platGbCd": "", "bun": "", "ji": ""}
    return {
        "sigunguCd": text[:5],
        "bjdongCd": text[5:10],
        "platGbCd": text[10:11],
        "bun": text[11:15].lstrip("0") or "0",
        "ji": text[15:19].lstrip("0") or "0",
    }


def _schema_payload(section_key: str) -> list[dict[str, str]]:
    return [
        {"field": field, "label": label}
        for field, label in BUILDING_HUB_SECTION_SCHEMAS.get(section_key, [])
    ]


def _floor_number(plan: dict[str, Any]) -> int:
    for key in ("floorNumber", "number", "index"):
        if plan.get(key) is not None:
            return _int_value(plan.get(key))
    match = re.search(r"(\d+)", str(plan.get("id") or plan.get("label") or ""))
    return int(match.group(1)) if match else 0


def _floor_label(plan: dict[str, Any]) -> str:
    label = _text(plan.get("label"))
    if label:
        return label
    floor_no = _floor_number(plan)
    return f"지하 {floor_no}층" if plan.get("type") == "basement" else f"{floor_no}층"


def _component_area_by_floor(building_program: dict[str, Any]) -> dict[str, dict[str, float]]:
    grouped: dict[str, dict[str, float]] = {}
    for component in building_program.get("areaComponents") or []:
        floor_id = _text(component.get("floorId") or component.get("id"))
        if not floor_id:
            continue
        bucket = grouped.setdefault(floor_id, {"exclusiveArea": 0.0, "commonArea": 0.0, "totalArea": 0.0})
        area = _float_value(component.get("areaM2"))
        kind = _text(component.get("areaKind"))
        if kind == "exclusive":
            bucket["exclusiveArea"] += area
        elif kind in ("common", "mechanical", "service_common"):
            bucket["commonArea"] += area
        bucket["totalArea"] += area
    return grouped


def _floor_area(plan: dict[str, Any], component_areas: dict[str, dict[str, float]]) -> dict[str, float]:
    plan_area = _float_value(plan.get("areaM2"))
    components = component_areas.get(_text(plan.get("id"))) or {}
    total = _float_value(components.get("totalArea")) or plan_area
    exclusive = _float_value(components.get("exclusiveArea")) or total
    common = _float_value(components.get("commonArea"))
    return {
        "area": _rounded(total),
        "exclusiveArea": _rounded(exclusive),
        "commonArea": _rounded(common),
    }


def _main_use(floor_plans: list[dict[str, Any]], building_program: dict[str, Any]) -> str:
    use_groups = building_program.get("useGroups") or []
    if use_groups:
        sorted_groups = sorted(use_groups, key=lambda group: _float_value(group.get("grossAreaM2")), reverse=True)
        return _text(sorted_groups[0].get("subcategory") or sorted_groups[0].get("categoryName") or sorted_groups[0].get("label"), "-")
    uses = [_text(plan.get("use")) for plan in floor_plans if _text(plan.get("use"))]
    return uses[0] if uses else "-"


def _unit_count(unit_summary: dict[str, Any]) -> int:
    return _int_value(unit_summary.get("unitCount"))


def _unit_rows(building_program: dict[str, Any], dong_name: str) -> list[dict[str, Any]]:
    rows = []
    units = (building_program.get("unitSummary") or {}).get("units") or []
    for index, unit in enumerate(units):
        count = _int_value(unit.get("count") or 1) or 1
        unit_area = _float_value(unit.get("unitExclusiveAreaM2") or unit.get("exclusiveAreaM2"))
        rows.append(
            {
                "dongNm": dong_name,
                "hoNm": _text(unit.get("name") or unit.get("id"), f"{index + 1}호군"),
                "mainPurpsCdNm": _text(unit.get("use"), "-"),
                "unitCnt": count,
                "exposPubuseArea": _rounded(unit_area),
                "totalExposPubuseArea": _rounded(count * unit_area),
                "source": "modelSettings.buildingProgram.units",
                "needsManualReview": True,
            }
        )
    return rows


def build_building_permit_overview(
    parcel: dict[str, Any],
    regulations: dict[str, Any],
    floor_plans: list[dict[str, Any]],
    model_settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    model_settings = model_settings or {}
    building_program = regulations.get("buildingProgram") or {}
    parking = regulations.get("parkingCalculation") or {}
    computed = regulations.get("computed") or {}
    limits = regulations.get("limits") or {}
    zone = regulations.get("zone") or {}
    unit_summary = building_program.get("unitSummary") or {}
    pnu = _pnu_parts(parcel.get("pnu"))
    floor_plans = floor_plans or []
    above = [plan for plan in floor_plans if plan.get("type") == "above"]
    basement = [plan for plan in floor_plans if plan.get("type") == "basement"]
    site_area = _float_value(computed.get("site_area_m2") or parcel.get("area_m2"))
    building_area = max([_float_value(plan.get("areaM2")) for plan in above] or [0.0])
    gross_area = sum(_float_value(plan.get("areaM2")) for plan in floor_plans)
    far_area = sum(_float_value(plan.get("areaM2")) for plan in above)
    bcr = building_area / site_area * 100 if site_area > 0 else 0.0
    far = far_area / site_area * 100 if site_area > 0 else 0.0
    height = sum(_float_value(plan.get("heightM")) for plan in above)
    main_use = _main_use(floor_plans, building_program)
    dong_name = _text(model_settings.get("mainDongName"), "주건축물")
    planned_parking = model_settings.get("parkingCount")
    required_parking = parking.get("requiredCount") if parking.get("available") else parking.get("partialRequiredCount")
    total_parking = _float_value(planned_parking) or _float_value(required_parking)
    component_areas = _component_area_by_floor(building_program)

    floor_rows = []
    for plan in floor_plans:
        area = _floor_area(plan, component_areas)
        floor_rows.append(
            {
                "dongNm": dong_name,
                "flrGbCdNm": "지하" if plan.get("type") == "basement" else "지상",
                "flrNo": _floor_number(plan),
                "flrNoNm": _floor_label(plan),
                "mainPurpsCdNm": _text(plan.get("use"), "-"),
                "area": area["area"],
                "exposPubuseArea": area["exclusiveArea"],
                "pubuseArea": area["commonArea"],
                "source": "floorPlans",
                "autoFilled": True,
                "needsManualReview": bool(area["commonArea"] == 0 and building_program.get("commonAreaAllocation", {}).get("status") == "candidate"),
            }
        )

    zoning_rows = [
        {
            "zoneNm": _text(zone.get("matched") or zone.get("primary")),
            "districtNm": _text(zone.get("secondary")),
            "areaNm": "",
            "source": "regulations.zone",
            "autoFilled": bool(zone),
        }
    ]

    basic = {
        **pnu,
        "platPlc": _text(parcel.get("address")),
        "mgmPmsrgstPk": "",
        "bldNm": _text(model_settings.get("buildingName")),
        "splotNm": "",
        "block": "",
        "lot": "",
        "jimokNm": _text(parcel.get("land_category") or parcel.get("landCategory")),
        "mainPurpsCdNm": main_use,
        "archGbCdNm": _text(model_settings.get("permitType"), "신축"),
        "platArea": _rounded(site_area),
        "archArea": _rounded(building_area),
        "bcRat": _rounded(bcr),
        "totArea": _rounded(gross_area),
        "vlRatEstmTotArea": _rounded(far_area),
        "vlRat": _rounded(far),
        "legalBcRat": _rounded(limits.get("bcr_percent")),
        "legalVlRat": _rounded(limits.get("far_percent")),
        "mainBldCnt": 1 if floor_plans else 0,
        "atchBldDongCnt": _int_value(model_settings.get("attachedBuildingCount")),
        "hhldCnt": _unit_count(unit_summary),
        "hoCnt": _unit_count(unit_summary),
        "fmlyCnt": _unit_count(unit_summary),
        "totPkngCnt": _rounded(total_parking),
    }

    dong = {
        "dongNm": dong_name,
        "mainPurpsCdNm": main_use,
        "mainStrctCdNm": _text(model_settings.get("buildingStructure"), "철근콘크리트 라멘조"),
        "roofCdNm": _text(model_settings.get("roofType")),
        "grndFlrCnt": len(above),
        "ugrndFlrCnt": len(basement),
        "heit": _rounded(height),
        "archArea": _rounded(building_area),
        "totArea": _rounded(gross_area),
        "source": "floorPlans/modelSettings",
        "autoFilled": True,
    }

    parking_overview = {
        "totPkngCnt": _rounded(total_parking),
        "requiredPkngCnt": _rounded(required_parking),
        "plannedPkngCnt": _rounded(planned_parking),
        "indrMechUtcnt": 0,
        "indrAutoUtcnt": _rounded(total_parking),
        "oudrMechUtcnt": 0,
        "oudrAutoUtcnt": 0,
        "available": parking.get("available"),
        "message": parking.get("message"),
        "source": "parkingCalculation/modelSettings.parkingCount",
        "needsManualReview": bool(parking.get("needsManualReview")),
    }

    return {
        "source": "building-hub-permit-compatible-draft",
        "schemaVersion": "building-hub-permit-overview-v0.1",
        "standardName": "국토교통부 건축HUB 건축인허가정보 서비스 기반 세움터 호환 개요 초안",
        "standardReferences": [
            "국토교통부_건축HUB_건축인허가정보 서비스",
            "세움터 건축허가 입력 항목과 유사한 기본개요/동별개요/층별개요/호별개요/주차장 섹션",
        ],
        "schemas": {
            key: _schema_payload(key)
            for key in BUILDING_HUB_SECTION_SCHEMAS
        },
        "sections": {
            "basicOverview": basic,
            "siteLocation": {
                "platPlc": basic["platPlc"],
                "newPlatPlc": _text(parcel.get("road_address")),
                "pnu": _text(parcel.get("pnu")),
                **pnu,
            },
            "zoningDistricts": zoning_rows,
            "dongOverviews": [dong] if floor_plans else [],
            "floorOverviews": floor_rows,
            "unitOverviews": _unit_rows(building_program, dong_name),
            "exclusiveCommonAreas": building_program.get("commonAreaAllocation") or {},
            "parking": parking_overview,
            "attachedParkingLots": parking.get("rows") or [],
        },
        "uiHints": {
            "manualInputFields": [
                "basicOverview.bldNm",
                "dongOverviews[].dongNm",
                "dongOverviews[].mainStrctCdNm",
                "unitOverviews[]",
                "parking.plannedPkngCnt",
            ],
            "autoFilledFields": [
                "basicOverview.platArea",
                "basicOverview.archArea",
                "basicOverview.bcRat",
                "basicOverview.totArea",
                "basicOverview.vlRatEstmTotArea",
                "basicOverview.vlRat",
                "floorOverviews[]",
                "zoningDistricts[]",
            ],
        },
        "needsManualReview": True,
    }
