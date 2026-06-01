import unittest

from engine.regulation.building_program_model import build_building_program_summary


API_TAXONOMY = {
    "status": "parsed",
    "authoritative": True,
    "categories": [
        {"number": 1, "name": "단독주택", "subcategories": [{"label": "다", "text": "다가구주택"}]},
        {"number": 2, "name": "공동주택", "subcategories": [{"label": "가", "text": "아파트"}]},
        {"number": 3, "name": "제1종 근린생활시설", "subcategories": []},
        {"number": 7, "name": "판매시설", "subcategories": []},
        {"number": 14, "name": "업무시설", "subcategories": [{"label": "다", "text": "오피스텔"}]},
    ],
}


class BuildingProgramModelTest(unittest.TestCase):
    def test_general_building_from_floor_uses(self):
        summary = build_building_program_summary(
            [
                {"id": "floor_01", "type": "above", "use": "제1종 근린생활시설", "areaM2": 120},
                {"id": "floor_02", "type": "above", "use": "판매시설", "areaM2": 120},
            ],
            building_use_taxonomy=API_TAXONOMY,
        )

        self.assertEqual(summary["projectType"], "mixed_use_general")
        self.assertEqual(summary["areaSummary"]["exclusiveAreaM2"], 240)
        self.assertTrue(summary["parkingReadiness"]["areaBasedUsesReady"])

    def test_neighborhood_house_requires_unit_and_common_area_inputs(self):
        summary = build_building_program_summary(
            [
                {"id": "floor_01", "type": "above", "use": "제1종 근린생활시설", "areaM2": 80},
                {"id": "floor_02", "type": "above", "use": "다가구주택", "areaM2": 80},
                {"id": "floor_03", "type": "above", "use": "공용 계단실", "areaM2": 20},
            ],
            building_use_taxonomy=API_TAXONOMY,
        )

        self.assertEqual(summary["projectType"], "neighborhood_house")
        self.assertEqual(summary["commonAreaAllocation"]["status"], "candidate")
        self.assertIn("주택/오피스텔 세대·호실별 전용면적", summary["parkingReadiness"]["missingInputs"])
        self.assertIn("주거/비주거 공용면적 구분 또는 배분 기준", summary["parkingReadiness"]["missingInputs"])

    def test_officetel_with_explicit_units_can_be_parking_ready_for_housing_part(self):
        summary = build_building_program_summary(
            [{"id": "floor_01", "type": "above", "use": "오피스텔", "areaM2": 300}],
            {
                "buildingProgram": {
                    "units": [
                        {"use": "오피스텔", "count": 6, "unitExclusiveAreaM2": 45},
                    ]
                }
            },
            API_TAXONOMY,
        )

        self.assertEqual(summary["projectType"], "officetel")
        self.assertEqual(summary["unitSummary"]["unitCount"], 6)
        self.assertEqual(summary["unitSummary"]["totalExclusiveAreaM2"], 270)
        self.assertTrue(summary["parkingReadiness"]["housingCalculationReady"])

    def test_mixed_use_residential_from_apartment_and_general_use(self):
        summary = build_building_program_summary(
            [
                {"id": "floor_01", "type": "above", "use": "판매시설", "areaM2": 200},
                {"id": "floor_02", "type": "above", "use": "아파트", "areaM2": 600},
            ],
            building_use_taxonomy=API_TAXONOMY,
        )

        self.assertEqual(summary["projectType"], "mixed_use_residential")
        self.assertTrue(summary["parkingReadiness"]["requiresHousingUnitInputs"])

    def test_declared_project_type_overrides_inferred_summary(self):
        summary = build_building_program_summary(
            [{"id": "floor_01", "type": "above", "use": "판매시설", "areaM2": 200}],
            {"buildingProgram": {"declaredProjectType": "neighborhood_house"}},
            API_TAXONOMY,
        )

        self.assertEqual(summary["projectType"], "neighborhood_house")
        self.assertEqual(summary["projectTypeLabel"], "상가주택")


if __name__ == "__main__":
    unittest.main()
