"""Normalize building uses against official Building Act use taxonomy.

Legal classifications should come from law.go.kr documents. The seed taxonomy
below is only a non-authoritative fallback used to keep matching explainable
when the API is not configured.
"""

from __future__ import annotations

import re
from typing import Any

SOURCE = "건축법 시행령 별표 1 건축물의 용도"
API_SOURCE_STATUS = "law-api-parsed"
SEED_SOURCE_STATUS = "seed-fallback"


def _norm(text: str) -> str:
    return re.sub(r"[\s·ㆍ,()（）\[\]{}「」『』`\"']", "", str(text or "")).lower()


USE_CATEGORIES: list[dict[str, Any]] = [
    {"number": 1, "name": "단독주택", "parkingCategory": "detached_house", "aliases": ["단독주택", "단독", "다중주택", "공관"]},
    {"number": 2, "name": "공동주택", "parkingCategory": "housing_standard", "aliases": ["공동주택", "아파트", "연립주택", "다세대주택", "기숙사"]},
    {"number": 3, "name": "제1종 근린생활시설", "parkingCategory": "neighborhood_living", "aliases": ["제1종근린생활시설", "1종근린생활시설", "일용품소매점", "휴게음식점", "의원", "공중화장실"]},
    {"number": 4, "name": "제2종 근린생활시설", "parkingCategory": "neighborhood_living", "aliases": ["제2종근린생활시설", "2종근린생활시설", "일반음식점", "사무소", "고시원", "학원", "독서실"]},
    {"number": 5, "name": "문화 및 집회시설", "parkingCategory": "assembly_area100", "aliases": ["문화및집회시설", "공연장", "집회장", "관람장", "전시장", "동식물원"]},
    {"number": 6, "name": "종교시설", "parkingCategory": "assembly_area100", "aliases": ["종교시설", "교회", "성당", "사찰", "기도원", "수도원", "수녀원"]},
    {"number": 7, "name": "판매시설", "parkingCategory": "retail", "aliases": ["판매시설", "소매시장", "상점", "백화점", "대형마트", "쇼핑센터"]},
    {"number": 8, "name": "운수시설", "parkingCategory": "assembly_area100", "aliases": ["운수시설", "여객자동차터미널", "철도시설", "공항시설", "항만시설"]},
    {"number": 9, "name": "의료시설", "parkingCategory": "assembly_area100", "aliases": ["의료시설", "병원", "종합병원", "치과병원", "한방병원", "요양병원"]},
    {"number": 10, "name": "교육연구시설", "parkingCategory": "education", "aliases": ["교육연구시설", "학교", "유치원", "연구소", "도서관"]},
    {"number": 11, "name": "노유자시설", "parkingCategory": "other", "aliases": ["노유자시설", "아동관련시설", "노인복지시설", "사회복지시설"]},
    {"number": 12, "name": "수련시설", "parkingCategory": "factory_training_power", "aliases": ["수련시설", "생활권수련시설", "자연권수련시설", "유스호스텔"]},
    {"number": 13, "name": "운동시설", "parkingCategory": "assembly_area100", "aliases": ["운동시설", "체육관", "운동장", "골프장", "골프연습장", "옥외수영장"]},
    {"number": 14, "name": "업무시설", "parkingCategory": "office", "aliases": ["업무시설", "일반업무시설", "공공업무시설", "사무실", "오피스"]},
    {"number": 15, "name": "숙박시설", "parkingCategory": "neighborhood_living", "aliases": ["숙박시설", "호텔", "여관", "관광호텔", "생활숙박시설"]},
    {"number": 16, "name": "위락시설", "parkingCategory": "entertainment", "aliases": ["위락시설", "단란주점", "유흥주점", "카지노", "무도장"]},
    {"number": 17, "name": "공장", "parkingCategory": "factory_training_power", "aliases": ["공장", "아파트형공장", "제조소"]},
    {"number": 18, "name": "창고시설", "parkingCategory": "warehouse", "aliases": ["창고시설", "창고", "하역장", "물류터미널", "집배송시설"]},
    {"number": 19, "name": "위험물 저장 및 처리 시설", "parkingCategory": "other", "aliases": ["위험물저장및처리시설", "주유소", "액화석유가스충전소"]},
    {"number": 20, "name": "자동차 관련 시설", "parkingCategory": "other", "aliases": ["자동차관련시설", "주차장", "세차장", "폐차장", "검사장", "정비공장"]},
    {"number": 21, "name": "동물 및 식물 관련 시설", "parkingCategory": "other", "aliases": ["동물및식물관련시설", "축사", "가축시설", "온실", "작물재배사"]},
    {"number": 22, "name": "자원순환 관련 시설", "parkingCategory": "other", "aliases": ["자원순환관련시설", "고물상", "폐기물재활용시설", "폐기물처리시설"]},
    {"number": 23, "name": "교정 및 군사 시설", "parkingCategory": "other", "aliases": ["교정및군사시설", "교도소", "구치소", "군사시설"]},
    {"number": 24, "name": "방송통신시설", "parkingCategory": "broadcasting", "aliases": ["방송통신시설", "방송국", "전신전화국", "촬영소", "통신용시설", "데이터센터"]},
    {"number": 25, "name": "발전시설", "parkingCategory": "factory_training_power", "aliases": ["발전시설", "발전소"]},
    {"number": 26, "name": "묘지 관련 시설", "parkingCategory": "other", "aliases": ["묘지관련시설", "화장시설", "봉안당", "묘지"]},
    {"number": 27, "name": "관광 휴게시설", "parkingCategory": "other", "aliases": ["관광휴게시설", "야외음악당", "야외극장", "어린이회관", "휴게소"]},
    {"number": 28, "name": "장례시설", "parkingCategory": "assembly_area100", "aliases": ["장례시설", "장례식장"]},
    {"number": 29, "name": "야영장 시설", "parkingCategory": "other", "aliases": ["야영장시설", "야영장"]},
]


SPECIAL_ALIASES: list[dict[str, Any]] = [
    {"alias": "다가구주택", "number": 1, "name": "단독주택", "subcategory": "다가구주택", "parkingCategory": "housing_standard"},
    {"alias": "오피스텔", "number": 14, "name": "업무시설", "subcategory": "오피스텔", "parkingCategory": "housing_standard"},
    {"alias": "일반업무시설", "number": 14, "name": "업무시설", "subcategory": "일반업무시설", "parkingCategory": "office"},
    {"alias": "공공업무시설", "number": 14, "name": "업무시설", "subcategory": "공공업무시설", "parkingCategory": "office"},
    {"alias": "학생용기숙사", "number": 2, "name": "공동주택", "subcategory": "학생용기숙사", "parkingCategory": "dormitory"},
    {"alias": "데이터센터", "number": 24, "name": "방송통신시설", "subcategory": "데이터센터", "parkingCategory": "data_center"},
    {"alias": "골프장", "number": 13, "name": "운동시설", "subcategory": "골프장", "parkingCategory": "unit_based"},
    {"alias": "골프연습장", "number": 13, "name": "운동시설", "subcategory": "골프연습장", "parkingCategory": "unit_based"},
]


AMBIGUOUS_ALIASES: list[dict[str, Any]] = [
    {"alias": "상가", "name": "근린생활시설 또는 판매시설", "parkingCategory": "neighborhood_living"},
    {"alias": "근생", "name": "근린생활시설", "parkingCategory": "neighborhood_living"},
]


def _payload(
    *,
    input_text: str,
    number: int | None,
    name: str,
    parking_category: str,
    subcategory: str | None = None,
    matched_alias: str | None = None,
    confidence: str = "high",
    needs_manual_review: bool = False,
    source_status: str = API_SOURCE_STATUS,
    authoritative: bool = True,
) -> dict[str, Any]:
    return {
        "input": input_text,
        "source": SOURCE,
        "sourceStatus": source_status,
        "authoritative": authoritative,
        "categoryNumber": number,
        "categoryName": name,
        "subcategory": subcategory,
        "matchedAlias": matched_alias,
        "parkingCategory": parking_category,
        "confidence": confidence,
        "needsManualReview": needs_manual_review,
    }


def _parking_category_for(
    category_name: str,
    subcategory: str | None = None,
    matched_alias: str | None = None,
) -> str:
    search_text = " ".join(str(value or "") for value in [category_name, subcategory, matched_alias])
    for item in SPECIAL_ALIASES:
        if item["alias"] in search_text:
            return str(item["parkingCategory"])
    normalized_name = _norm(category_name)
    for category in USE_CATEGORIES:
        if _norm(category["name"]) == normalized_name:
            return str(category["parkingCategory"])
    return "other"


def _classify_from_api_taxonomy(raw: str, normalized: str, taxonomy: dict[str, Any]) -> dict[str, Any] | None:
    if taxonomy.get("status") != "parsed":
        return None

    for category in taxonomy.get("categories") or []:
        category_name = str(category.get("name") or "")
        subcategories = list(category.get("subcategories") or [])

        for item in sorted(SPECIAL_ALIASES, key=lambda value: len(value["alias"]), reverse=True):
            alias = str(item["alias"])
            if _norm(alias) not in normalized:
                continue
            if _norm(alias) in _norm(category_name) or any(_norm(alias) in _norm(sub.get("text")) for sub in subcategories):
                return _payload(
                    input_text=raw,
                    number=category.get("number"),
                    name=category_name,
                    subcategory=item.get("subcategory") or alias,
                    matched_alias=alias,
                    parking_category=str(item["parkingCategory"]),
                    needs_manual_review=False,
                )

        if _norm(category_name) and _norm(category_name) in normalized:
            return _payload(
                input_text=raw,
                number=category.get("number"),
                name=category_name,
                matched_alias=category_name,
                parking_category=_parking_category_for(category_name),
                needs_manual_review=False,
            )

        for subcategory in subcategories:
            sub_text = str(subcategory.get("text") or "")
            compact_sub_text = _norm(sub_text)
            if compact_sub_text and (compact_sub_text in normalized or normalized in compact_sub_text):
                return _payload(
                    input_text=raw,
                    number=category.get("number"),
                    name=category_name,
                    subcategory=sub_text[:80],
                    matched_alias=sub_text[:80],
                    parking_category=_parking_category_for(category_name, sub_text),
                    confidence="medium",
                    needs_manual_review=False,
                )

    return None


def _seed_payload(**kwargs: Any) -> dict[str, Any]:
    kwargs["source_status"] = SEED_SOURCE_STATUS
    kwargs["authoritative"] = False
    kwargs["needs_manual_review"] = True
    return _payload(**kwargs)


def classify_building_use(
    use_text: str | None,
    taxonomy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    raw = str(use_text or "").strip()
    normalized = _norm(raw)
    if not normalized:
        return _seed_payload(
            input_text=raw,
            number=None,
            name="그 밖의 건축물",
            parking_category="other",
            confidence="low",
        )

    api_match = _classify_from_api_taxonomy(raw, normalized, taxonomy or {})
    if api_match:
        return api_match

    for item in sorted(SPECIAL_ALIASES, key=lambda value: len(value["alias"]), reverse=True):
        if _norm(item["alias"]) in normalized:
            return _seed_payload(
                input_text=raw,
                number=item["number"],
                name=item["name"],
                subcategory=item.get("subcategory"),
                matched_alias=item["alias"],
                parking_category=item["parkingCategory"],
            )

    for category in USE_CATEGORIES:
        aliases = [category["name"], *category.get("aliases", [])]
        for alias in sorted(aliases, key=len, reverse=True):
            if _norm(alias) in normalized:
                return _seed_payload(
                    input_text=raw,
                    number=category["number"],
                    name=category["name"],
                    matched_alias=alias,
                    parking_category=category["parkingCategory"],
                )

    for item in AMBIGUOUS_ALIASES:
        if _norm(item["alias"]) in normalized:
            return _payload(
                input_text=raw,
                number=None,
                name=item["name"],
                matched_alias=item["alias"],
                parking_category=item["parkingCategory"],
                confidence="medium",
                needs_manual_review=True,
                source_status=SEED_SOURCE_STATUS,
                authoritative=False,
            )

    return _seed_payload(
        input_text=raw,
        number=None,
        name="그 밖의 건축물",
        matched_alias=None,
        parking_category="other",
        confidence="low",
    )
