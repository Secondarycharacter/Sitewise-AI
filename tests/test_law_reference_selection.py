import unittest

from engine.regulation.law_provider import LawReference
from engine.regulation.ordinance_engine import _ranked_appendix_references, _ranked_ordinance_references


def reference(title: str, target: str = "licbyl", raw=None) -> LawReference:
    return LawReference(
        id=title,
        title=title,
        target=target,
        provider="test",
        source_name="test",
        raw=raw or {},
    )


class LawReferenceSelectionTest(unittest.TestCase):
    def test_building_use_taxonomy_prefers_building_act_appendix_1(self):
        candidates = [
            reference("서울특별시 주차장 설치 및 관리 조례 [별표 2]"),
            reference("건축 조례 [별표 1] 대지안의 공지"),
            reference(
                "건축법 시행령 [별표 1] 용도별 건축물의 종류",
                raw={"별표명": "건축물의 용도"},
            ),
        ]

        selected = _ranked_appendix_references(candidates, "building_use_taxonomy", limit=1)

        self.assertEqual(selected[0].title, "건축법 시행령 [별표 1] 용도별 건축물의 종류")

    def test_parking_requirement_prefers_required_count_appendix_over_restricted_area(self):
        candidates = [
            reference("서울특별시 주차장 설치 및 관리 조례 [별표 3] 설치제한 지역"),
            reference("서울특별시 건축 조례 [별표 2] 대지안의 공지"),
            reference(
                "서울특별시 주차장 설치 및 관리 조례 [별표 2]",
                raw={"별표명": "부설주차장의 설치대상 시설물 종류 및 설치기준"},
            ),
        ]

        selected = _ranked_appendix_references(
            candidates,
            "parking_required_count",
            jurisdiction_name="서울특별시",
            limit=1,
        )

        self.assertEqual(selected[0].title, "서울특별시 주차장 설치 및 관리 조례 [별표 2]")

    def test_parking_ordinance_prefers_exact_metropolitan_ordinance(self):
        candidates = [
            reference("서울특별시 강남구 주차장 설치 및 관리 조례", target="ordin"),
            reference("서울특별시 강동구 주차장 설치 및 관리 조례", target="ordin"),
            reference("서울특별시 주차장 설치 및 관리 조례", target="ordin"),
            reference("서울특별시 주차장특별회계 설치 조례", target="ordin"),
        ]

        selected = _ranked_ordinance_references(
            candidates,
            "주차장 설치 및 관리 조례",
            jurisdiction_name="서울특별시",
            limit=1,
        )

        self.assertEqual(selected[0].title, "서울특별시 주차장 설치 및 관리 조례")


if __name__ == "__main__":
    unittest.main()
