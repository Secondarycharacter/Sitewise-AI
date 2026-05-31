"""주소에서 법규 조회에 필요한 관할 지자체를 추출한다."""

from __future__ import annotations

import re
from typing import Any

from engine.regulation.law_provider import Jurisdiction

SIDO_ALIASES = {
    "서울": "서울특별시",
    "서울시": "서울특별시",
    "서울특별시": "서울특별시",
    "부산": "부산광역시",
    "부산시": "부산광역시",
    "부산광역시": "부산광역시",
    "대구": "대구광역시",
    "대구시": "대구광역시",
    "대구광역시": "대구광역시",
    "인천": "인천광역시",
    "인천시": "인천광역시",
    "인천광역시": "인천광역시",
    "광주": "광주광역시",
    "광주시": "광주광역시",
    "광주광역시": "광주광역시",
    "대전": "대전광역시",
    "대전시": "대전광역시",
    "대전광역시": "대전광역시",
    "울산": "울산광역시",
    "울산시": "울산광역시",
    "울산광역시": "울산광역시",
    "세종": "세종특별자치시",
    "세종시": "세종특별자치시",
    "세종특별자치시": "세종특별자치시",
    "경기": "경기도",
    "경기도": "경기도",
    "강원": "강원특별자치도",
    "강원도": "강원특별자치도",
    "강원특별자치도": "강원특별자치도",
    "충북": "충청북도",
    "충청북도": "충청북도",
    "충남": "충청남도",
    "충청남도": "충청남도",
    "전북": "전북특별자치도",
    "전라북도": "전북특별자치도",
    "전북특별자치도": "전북특별자치도",
    "전남": "전라남도",
    "전라남도": "전라남도",
    "경북": "경상북도",
    "경상북도": "경상북도",
    "경남": "경상남도",
    "경상남도": "경상남도",
    "제주": "제주특별자치도",
    "제주도": "제주특별자치도",
    "제주특별자치도": "제주특별자치도",
}

METROPOLITAN_SIDOS = {
    "서울특별시",
    "부산광역시",
    "대구광역시",
    "인천광역시",
    "광주광역시",
    "대전광역시",
    "울산광역시",
}


def _tokens(address: str) -> list[str]:
    cleaned = re.sub(r"[\(\),]", " ", address)
    return [token for token in re.split(r"\s+", cleaned.strip()) if token]


def _normalize_sido(token: str) -> str | None:
    return SIDO_ALIASES.get(token)


def _parse_address(address: str) -> Jurisdiction:
    tokens = _tokens(address)
    warnings: list[str] = []
    sido: str | None = None
    sido_index: int | None = None

    for index, token in enumerate(tokens):
        normalized = _normalize_sido(token)
        if normalized:
            sido = normalized
            sido_index = index
            break

    if not sido:
        return Jurisdiction(
            source_address=address,
            confidence="low",
            warnings=["주소에서 시도명을 식별하지 못했습니다."],
        )

    after_sido = tokens[(sido_index or 0) + 1 :]
    local_tokens = [token for token in after_sido if re.search(r"(시|군|구)$", token)]
    sigungu: str | None = None

    if sido == "세종특별자치시":
        sigungu = None
    elif sido in METROPOLITAN_SIDOS:
        sigungu = next((token for token in local_tokens if token.endswith("구")), None)
        sigungu = sigungu or (local_tokens[0] if local_tokens else None)
    else:
        sigungu = next(
            (token for token in local_tokens if token.endswith(("시", "군"))),
            None,
        )
        sigungu = sigungu or (local_tokens[0] if local_tokens else None)

    if not sigungu and sido != "세종특별자치시":
        warnings.append("주소에서 시군구명을 식별하지 못했습니다.")

    confidence = "high" if sido and (sigungu or sido == "세종특별자치시") else "medium"
    return Jurisdiction(
        sido=sido,
        sigungu=sigungu,
        source_address=address,
        confidence=confidence,
        warnings=warnings,
    )


def resolve_jurisdiction(parcel_or_address: dict[str, Any] | str | None) -> Jurisdiction:
    if isinstance(parcel_or_address, str):
        return _parse_address(parcel_or_address)

    if not parcel_or_address:
        return Jurisdiction(confidence="low", warnings=["주소 데이터가 없습니다."])

    candidates = [
        parcel_or_address.get("road_address"),
        parcel_or_address.get("address"),
    ]
    for candidate in candidates:
        if not candidate:
            continue
        jurisdiction = _parse_address(str(candidate))
        if jurisdiction.sido:
            return jurisdiction

    return Jurisdiction(
        source_address=str(parcel_or_address.get("address") or ""),
        confidence="low",
        warnings=["지번/도로명 주소에서 관할 지자체를 식별하지 못했습니다."],
    )
