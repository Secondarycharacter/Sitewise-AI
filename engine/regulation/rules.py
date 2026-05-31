"""Fallback 기본 규정표.

법제처 Open API/자치법규 조회가 실패하거나 아직 계산 규칙으로 구조화되지 않은
항목에 한해 참고용으로 사용한다.
"""

ZONE_RULES: dict[str, dict[str, float | int | str]] = {
    "제1종전용주거지역": {"bcr": 50, "far": 100, "max_height_m": 10},
    "제2종전용주거지역": {"bcr": 50, "far": 120, "max_height_m": 10},
    "제1종일반주거지역": {"bcr": 60, "far": 200, "max_height_m": None},
    "제2종일반주거지역": {"bcr": 60, "far": 250, "max_height_m": None},
    "제3종일반주거지역": {"bcr": 50, "far": 300, "max_height_m": None},
    "준주거지역": {"bcr": 70, "far": 400, "max_height_m": None},
    "중심상업지역": {"bcr": 90, "far": 1000, "max_height_m": None},
    "일반상업지역": {"bcr": 80, "far": 1300, "max_height_m": None},
    "근린상업지역": {"bcr": 70, "far": 900, "max_height_m": None},
    "전용공업지역": {"bcr": 70, "far": 300, "max_height_m": None},
    "일반공업지역": {"bcr": 70, "far": 350, "max_height_m": None},
    "준공업지역": {"bcr": 70, "far": 400, "max_height_m": None},
    "보전녹지지역": {"bcr": 20, "far": 100, "max_height_m": None},
    "생산녹지지역": {"bcr": 20, "far": 80, "max_height_m": None},
    "자연녹지지역": {"bcr": 20, "far": 100, "max_height_m": None},
    "관리지역": {"bcr": 40, "far": 100, "max_height_m": None},
    "농림지역": {"bcr": 20, "far": 80, "max_height_m": None},
    "자연환경보전지역": {"bcr": 20, "far": 80, "max_height_m": None},
}

DEFAULT_RULE = {"bcr": 60, "far": 200, "max_height_m": None, "zone_label": "미확인"}

ZONE_ALIASES: dict[str, str] = {
    "주거지역": "제2종일반주거지역",
    "상업지역": "일반상업지역",
    "공업지역": "일반공업지역",
    "녹지지역": "자연녹지지역",
}
