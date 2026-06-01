"""Accessible parking compliance placeholder with evidence requirements."""

from __future__ import annotations

from typing import Any


def build_accessible_parking_detail(
    parking_calculation: dict[str, Any] | None,
    model_settings: dict[str, Any] | None,
) -> dict[str, Any]:
    required_count = (parking_calculation or {}).get("requiredCount")
    planned_count = (model_settings or {}).get("parkingCount")
    return {
        "status": "needs_review",
        "requiredParkingCount": required_count,
        "plannedParkingCount": planned_count,
        "canAnswerNow": False,
        "reason": "장애인전용주차구획은 일반 주차대수만으로 확정하지 않고, 별도 법령/조례 기준과 소수점 처리 기준을 연결해야 합니다.",
        "requiredEvidence": [
            "장애인등편의법 및 시행령/시행규칙의 장애인전용주차구역 기준",
            "서울특별시 주차장 설치 및 관리 조례 장애인전용주차구획 조항",
            "최종 계획 주차대수",
            "해당 시설의 편의시설 설치대상 여부",
        ],
    }
