SETBACK_USE_OPTIONS: dict[str, dict[str, str | float]] = {
    "default": {
        "label": "미지정",
        "distance_m": 0.5,
        "source": "용도 미지정: 인접대지경계선 최소 이격 0.5m 기본 적용",
    },
    "exclusive_residential": {
        "label": "전용주거지역 내 일반 건축물(공동주택 제외)",
        "distance_m": 1.0,
        "source": "서울특별시 건축 조례 제30조/별표4: 전용주거지역 건축물 1m 이상",
    },
    "factory_quasi_industrial": {
        "label": "공장/자동차관련시설/위험물시설 - 준공업지역",
        "distance_m": 1.0,
        "source": "서울특별시 건축 조례 제30조/별표4: 준공업지역 해당 시설 1m 이상",
    },
    "factory_other": {
        "label": "공장/자동차관련시설/위험물시설 - 준공업 외 지역",
        "distance_m": 1.5,
        "source": "서울특별시 건축 조례 제30조/별표4: 준공업 외 지역 해당 시설 1.5m 이상",
    },
    "sales_large": {
        "label": "판매/숙박/문화집회/종교/장례식장 1,000㎡ 이상",
        "distance_m": 1.5,
        "source": "서울특별시 건축 조례 제30조/별표4: 해당 용도 1,000㎡ 이상 1.5m 이상",
    },
    "sales_small": {
        "label": "판매/숙박/문화집회/종교/장례식장 1,000㎡ 미만",
        "distance_m": 1.0,
        "source": "서울특별시 건축 조례 제30조/별표4: 해당 용도 1,000㎡ 미만 1m 이상",
    },
    "apartment": {
        "label": "공동주택 - 아파트",
        "distance_m": 3.0,
        "source": "서울특별시 건축 조례 제30조/별표4: 아파트 3m 이상",
    },
    "urban_living_studio": {
        "label": "30세대 미만 도시형생활주택(원룸형)",
        "distance_m": 2.0,
        "source": "서울특별시 건축 조례 제30조/별표4: 30세대 미만 원룸형 도시형생활주택 2m 이상",
    },
    "row_house": {
        "label": "공동주택 - 연립주택",
        "distance_m": 1.5,
        "source": "서울특별시 건축 조례 제30조/별표4: 연립주택 1.5m 이상",
    },
    "multi_family": {
        "label": "공동주택 - 다세대주택",
        "distance_m": 1.0,
        "source": "서울특별시 건축 조례 제30조/별표4: 다세대주택 1m 이상",
    },
}


def resolve_setback(building_use: str | None) -> dict[str, str | float]:
    key = (building_use or "").strip() or "default"
    option = SETBACK_USE_OPTIONS.get(key, SETBACK_USE_OPTIONS["default"])
    return {
        "building_use": key,
        "label": option["label"],
        "distance_m": float(option["distance_m"]),
        "source": option["source"],
    }
