"""Normalize 토지이음-style land use restriction evidence."""

from __future__ import annotations

from typing import Any

from engine.regulation.eum_client import EumClient

RESTRICTION_KEYWORDS = {
    "residential": ("단독주택", "공동주택", "다세대", "다가구", "아파트"),
    "neighborhood": ("근린생활시설", "소매점", "휴게음식점", "일반음식점"),
    "office": ("업무시설", "사무소", "오피스텔"),
    "parking": ("주차장", "부설주차장", "주차전용건축물"),
    "factory": ("공장",),
    "lodging": ("숙박시설", "호텔", "여관"),
}


def _flatten_values(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, dict):
        values: list[str] = []
        for nested in value.values():
            values.extend(_flatten_values(nested))
        return values
    if isinstance(value, list):
        values = []
        for item in value:
            values.extend(_flatten_values(item))
        return values
    text = str(value).strip()
    return [text] if text else []


def _district_entries(parcel: dict[str, Any]) -> list[dict[str, Any]]:
    land = parcel.get("land") or {}
    districts = []
    for source, label in (
        ("zone_primary", land.get("zone_primary")),
        ("zone_secondary", land.get("zone_secondary")),
    ):
        if label:
            districts.append({"name": str(label), "source": source, "kind": "용도지역"})
    for district in parcel.get("districts") or []:
        if district and str(district) not in [entry["name"] for entry in districts]:
            districts.append({"name": str(district), "source": "land_use_attr", "kind": "지역지구"})
    return districts


def _restriction_items_from_api(raw: dict[str, Any]) -> list[dict[str, Any]]:
    values = _flatten_values(raw)
    joined = "\n".join(values)
    if not joined:
        return []

    items: list[dict[str, Any]] = []
    for category, keywords in RESTRICTION_KEYWORDS.items():
        hits = [keyword for keyword in keywords if keyword in joined]
        if hits:
            items.append(
                {
                    "category": category,
                    "matchedKeywords": hits,
                    "status": "candidate",
                    "summary": f"{', '.join(hits)} 관련 행위제한 후보가 API 응답에서 확인되었습니다.",
                    "needsManualReview": True,
                }
            )
    return items


def build_eum_context(
    parcel: dict[str, Any],
    client: EumClient | None = None,
) -> dict[str, Any]:
    eum_client = client or EumClient()
    api_response = eum_client.fetch_land_use_restrictions(parcel.get("pnu"))
    district_entries = _district_entries(parcel)
    api_items = (
        _restriction_items_from_api(api_response.get("raw") or {})
        if api_response.get("status") == "ok"
        else []
    )

    fallback_items = [
        {
            "category": "district",
            "district": entry["name"],
            "status": "needs_restriction_text",
            "summary": f"{entry['name']}에 대한 토지이음 행위제한내용 원문 확인이 필요합니다.",
            "needsManualReview": True,
        }
        for entry in district_entries
    ]

    status = "api-indexed" if api_items else "districts-only" if district_entries else "data-missing"
    if api_response.get("status") == "error":
        status = "api-error"

    return {
        "status": status,
        "provider": api_response.get("provider") or "data-go-kr-eum",
        "districts": district_entries,
        "restrictionItems": api_items or fallback_items,
        "apiResponse": api_response,
        "needsManualReview": status != "api-indexed",
        "evidencePlan": [
            {
                "source": "공공데이터포털",
                "target": "토지이용규제정보서비스",
                "label": "지역·지구 등 안에서의 행위제한내용",
                "required": True,
                "status": "available" if api_response.get("status") == "ok" else "pending",
            },
            {
                "source": "공공데이터포털",
                "target": "토지이용규제법령정보서비스",
                "label": "행위제한 관련 법령/조례 조항",
                "required": True,
                "status": "pending",
            },
            {
                "source": "공공데이터포털",
                "target": "규제안내서서비스",
                "label": "건축 인허가 단계별 규제 안내",
                "required": False,
                "status": "pending",
            },
        ],
    }
