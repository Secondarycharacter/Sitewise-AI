import unittest

from engine.regulation.building_use_classifier import classify_building_use
from engine.regulation.parking_calculator import calculate_parking_requirements
from engine.regulation.parking_rule_parser import parse_parking_rules_from_text
from engine.regulation.site_compliance_engine import _parking_check


SEOUL_PARKING_APPENDIX_SAMPLE = """
■ 서울특별시 주차장 설치 및 관리 조례 [별표 2]
    부설주차장의 설치대상 시설물 종류 및 설치기준
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━┯━━━━━━━━━━━━━━━━━━━━━━━━┓
┃시설물                                                  │설치기준                                        ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━┿━━━━━━━━━━━━━━━━━━━━━━━━┫
┃2. 판매시설, 업무시설                                   │시설면적 100㎡당 1대                            ┃
┠────────────────────────────┼────────────────────────┨
┃2-1. 업무시설                                           │일반업무시설 : 시설면적 100㎡당 1대             ┃
┃                                                        │공공업무시설 : 시설면적 200㎡당 1대             ┃
┠────────────────────────────┼────────────────────────┨
┃3. 제1종근린생활시설                                    │시설면적 134㎡당 1대                            ┃
┃ (`제3호 바목 및 사목을 제외한다), 제2                  │                                                ┃
┃종 근린생활시설, 숙박시설                               │                                                ┃
┠────────────────────────────┼────────────────────────┨
┃5. 다가구주택, 공동주택 및 업무시설 중 오피스텔         │「주택건설기준 등에 관한 규정」 제27조제1항에   ┃
┃                                                        │따라 산정된 주차대수                            ┃
┠────────────────────────────┼────────────────────────┨
┃10. 그 밖의 건축물                                      │○ 학생용기숙사: 시설면적 400㎡당 1대           ┃
┃                                                        │○ 학교시설 : 시설면적 250㎡당 1대              ┃
┃                                                        │○ 학생용기숙사, 학교시설을 제외한 그 밖의 건   ┃
┃                                                        │축물: 시설면적 200㎡ 당 1대                     ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━┷━━━━━━━━━━━━━━━━━━━━━━━━┛

<비고>
4. 용도가 다른 시설물이 복합된 시설물에 설치하여야 하는 부설주차장의 주차대수는 용도가 다른 각 시설물별로 설치기준에 따라 산정한 소수점 이하 첫째자리까지의 주차대수를 합하여 산정한다.
6. 설치기준에 따라 주차대수를 산정함에 있어서 소수점 이하의 수가 0.5 이상인 경우에는 이를 1로 본다. 다만, 해당 시설물 전체에 대하여 설치기준을 적용하여 산정한 총 주차대수가 1대 미만인 경우에는 주차대수를 0으로 본다.
"""


class ParkingEngineTest(unittest.TestCase):
    def test_building_use_classifier_normalizes_legal_use_categories(self):
        office_tel = classify_building_use("오피스텔")
        neighborhood = classify_building_use("제2종 근린생활시설 일반음식점")

        self.assertFalse(office_tel["authoritative"])
        self.assertTrue(office_tel["needsManualReview"])
        self.assertEqual(office_tel["sourceStatus"], "seed-fallback")
        self.assertEqual(office_tel["categoryName"], "업무시설")
        self.assertEqual(office_tel["subcategory"], "오피스텔")
        self.assertEqual(office_tel["parkingCategory"], "housing_standard")
        self.assertEqual(neighborhood["categoryName"], "제2종 근린생활시설")
        self.assertEqual(neighborhood["parkingCategory"], "neighborhood_living")

    def test_rule_parser_extracts_variant_area_standards(self):
        parsed = parse_parking_rules_from_text(SEOUL_PARKING_APPENDIX_SAMPLE)

        office_rule = next(rule for rule in parsed["rules"] if rule["number"] == "2-1")
        other_rule = next(rule for rule in parsed["rules"] if rule["number"] == "10")

        self.assertEqual(office_rule["calculation"]["divisorM2"], 100.0)
        self.assertEqual(
            {variant["label"] for variant in office_rule["calculation"]["variants"]},
            {"일반업무시설", "공공업무시설"},
        )
        self.assertEqual(other_rule["calculation"]["divisorM2"], 200.0)
        self.assertEqual(parsed["applicationRules"]["mixedUseRoundToDecimalPlaces"], 1)

    def test_rule_parser_accepts_serialized_law_api_line_lists(self):
        serialized_text = repr(
            [
                [
                    "■ 서울특별시 주차장 설치 및 관리 조례 [별표 2]",
                    "부설주차장의 설치대상 시설물 종류 및 설치기준",
                    "┃시설물 │설치기준 ┃",
                    "┃1. 위락시설 │ 시설면적 67㎡당 1대 ┃",
                    "┃2. 업무시설 │ 시설면적 100㎡당 1대 ┃",
                    "1. 시설물의 종류는 「건축법 시행령」 별표 1에 따른다.",
                    "2. 시설물의 시설면적은 공용면적을 포함한 바닥면적의 합계를 말한다.",
                ]
            ]
        )

        parsed = parse_parking_rules_from_text(serialized_text)

        self.assertEqual(len(parsed["rules"]), 2)
        self.assertEqual(parsed["rules"][0]["calculation"]["divisorM2"], 67.0)
        self.assertEqual(len(parsed["notes"]), 2)

    def test_calculator_matches_specific_use_rules_and_variants(self):
        parsed = parse_parking_rules_from_text(SEOUL_PARKING_APPENDIX_SAMPLE)
        floors = [
            {"id": "near", "use": "제1종 근린생활시설", "areaM2": 134},
            {"id": "retail", "use": "판매시설", "areaM2": 100},
            {"id": "public-office", "use": "공공업무시설", "areaM2": 200},
            {"id": "officetel", "use": "오피스텔", "areaM2": 85},
            {"id": "other", "use": "그 밖의 건축물", "areaM2": 200},
        ]

        result = calculate_parking_requirements(floors, [parsed])

        self.assertFalse(result["available"])
        self.assertIsNone(result["requiredCount"])
        self.assertEqual(result["partialRequiredCount"], 4)
        self.assertEqual(
            [(row["use"], row["rule"]["number"]) for row in result["rows"]],
            [
                ("제1종 근린생활시설", "3"),
                ("판매시설", "2"),
                ("공공업무시설", "2-1"),
                ("오피스텔", "5"),
                ("그 밖의 건축물", "10"),
            ],
        )
        self.assertTrue(result["rows"][2]["formula"].startswith("공공업무시설:"))
        self.assertEqual(result["rows"][3]["legalUse"]["subcategory"], "오피스텔")
        self.assertTrue(result["rows"][3]["needsInput"])
        self.assertFalse(result["buildingUseTaxonomyAuthoritative"])
        self.assertTrue(result["needsManualReview"])

    def test_calculator_uses_building_program_for_external_housing_standard_rows(self):
        parsed = parse_parking_rules_from_text(SEOUL_PARKING_APPENDIX_SAMPLE)
        building_program = {
            "projectType": "officetel",
            "projectTypeLabel": "오피스텔",
            "unitSummary": {
                "unitCount": 6,
                "totalExclusiveAreaM2": 270,
                "units": [{"use": "오피스텔", "count": 6, "unitExclusiveAreaM2": 45}],
            },
            "commonAreaAllocation": {"status": "not_required", "allocations": []},
            "useGroups": [{"subcategory": "오피스텔", "parkingCategory": "housing_standard"}],
        }

        result = calculate_parking_requirements(
            [{"id": "officetel", "use": "오피스텔", "areaM2": 300}],
            [parsed],
            building_program=building_program,
        )

        self.assertFalse(result["available"])
        self.assertIsNone(result["requiredCount"])
        self.assertFalse(result["rows"][0]["needsInput"])
        self.assertEqual(result["rows"][0]["housingProgram"]["unitCount"], 6)
        self.assertEqual(result["rows"][0]["housingProgram"]["totalExclusiveAreaM2"], 270)

    def test_calculator_uses_api_taxonomy_as_authoritative_use_source(self):
        parsed = parse_parking_rules_from_text(SEOUL_PARKING_APPENDIX_SAMPLE)
        taxonomy = {
            "status": "parsed",
            "authoritative": True,
            "categories": [
                {"number": 7, "name": "판매시설", "subcategories": [{"label": "가", "text": "상점"}]},
                {
                    "number": 14,
                    "name": "업무시설",
                    "subcategories": [
                        {"label": "가", "text": "공공업무시설"},
                        {"label": "나", "text": "일반업무시설"},
                    ],
                },
            ],
        }
        floors = [
            {"id": "retail", "use": "판매시설", "areaM2": 100},
            {"id": "public-office", "use": "공공업무시설", "areaM2": 200},
        ]

        result = calculate_parking_requirements(floors, [parsed], taxonomy)

        self.assertTrue(result["buildingUseTaxonomyAuthoritative"])
        self.assertEqual(result["buildingUseTaxonomyStatus"], "parsed")
        self.assertFalse(result["rows"][0]["legalUse"]["needsManualReview"])
        self.assertTrue(result["rows"][1]["legalUse"]["authoritative"])
        self.assertEqual(result["rows"][1]["rule"]["number"], "2-1")

    def test_parking_check_requires_review_when_source_rules_are_not_final(self):
        parking = {
            "available": True,
            "requiredCount": 4,
            "needsManualReview": True,
            "rows": [],
        }

        check = _parking_check({"parkingCalculation": parking}, {"parkingCount": 4})

        self.assertEqual(check["status"], "needs_review")
        self.assertEqual(check["details"]["shortageCount"], 0)


if __name__ == "__main__":
    unittest.main()
