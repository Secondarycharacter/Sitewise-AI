"""Parking exception and restriction checks.

These checks intentionally avoid final legal answers until the site overlay and
ordinance exception evidence are connected.
"""

from __future__ import annotations

from typing import Any


def build_parking_exception_detail(
    parcel: dict[str, Any],
    regulations: dict[str, Any],
    parking_calculation: dict[str, Any] | None,
) -> dict[str, Any]:
    zone = (regulations.get("zone") or {}).get("matched")
    districts = (regulations.get("zone") or {}).get("districts") or parcel.get("districts") or []
    required_count = (parking_calculation or {}).get("requiredCount")
    has_restriction_reference = any(
        "설치제한" in str(reference.get("title") or "")
        for reference in regulations.get("appendixReferences", [])
    )

    return {
        "zone": zone,
        "districts": districts,
        "requiredCountBeforeExceptions": required_count,
        "hasRestrictionReference": has_restriction_reference,
        "exceptionCanChangeFinalCount": True,
        "status": "needs_review",
        "summary": "설치제한구역/인근 설치/예외 규정이 적용되면 기본 산정 주차대수와 최종 설치대수가 달라질 수 있습니다.",
        "requiredEvidence": [
            "대지가 주차장 설치제한구역 또는 관련 지구에 포함되는지 여부",
            "서울특별시 주차장 설치 및 관리 조례 제21조",
            "부설주차장의 설치제한 지역에서의 시설물 종류별 설치기준 별표",
        ],
    }
