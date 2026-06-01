import unittest

from engine.regulation.building_permit_overview import build_building_permit_overview


class BuildingPermitOverviewTest(unittest.TestCase):
    def test_builds_building_hub_compatible_sections_from_analysis(self):
        parcel = {
            "address": "서울특별시 강남구 역삼동 737",
            "road_address": "서울특별시 강남구 테헤란로",
            "pnu": "1168010100107370000",
            "area_m2": 300,
        }
        floor_plans = [
            {"id": "floor_01", "type": "above", "label": "1층", "use": "제1종 근린생활시설", "areaM2": 120, "heightM": 4},
            {"id": "floor_02", "type": "above", "label": "2층", "use": "오피스텔", "areaM2": 120, "heightM": 4},
            {"id": "basement_01", "type": "basement", "label": "지하 1층", "use": "주차장", "areaM2": 100, "heightM": 3},
        ]
        regulations = {
            "zone": {"matched": "제2종일반주거지역"},
            "limits": {"bcr_percent": 60, "far_percent": 200},
            "computed": {"site_area_m2": 300},
            "buildingProgram": {
                "projectType": "mixed_use_officetel",
                "projectTypeLabel": "오피스텔+일반건축용도",
                "unitSummary": {
                    "unitCount": 4,
                    "units": [{"use": "오피스텔", "count": 4, "unitExclusiveAreaM2": 30}],
                },
                "areaComponents": [],
                "useGroups": [{"label": "오피스텔", "grossAreaM2": 120}],
            },
            "parkingCalculation": {
                "available": False,
                "partialRequiredCount": 2,
                "needsManualReview": True,
                "rows": [],
            },
        }

        overview = build_building_permit_overview(
            parcel,
            regulations,
            floor_plans,
            {"buildingStructure": "철근콘크리트구조", "parkingCount": 4},
        )

        self.assertEqual(overview["schemaVersion"], "building-hub-permit-overview-v0.1")
        self.assertIn("basicOverview", overview["schemas"])
        self.assertEqual(overview["sections"]["basicOverview"]["sigunguCd"], "11680")
        self.assertEqual(overview["sections"]["basicOverview"]["bjdongCd"], "10100")
        self.assertEqual(overview["sections"]["basicOverview"]["platArea"], 300)
        self.assertEqual(overview["sections"]["basicOverview"]["totArea"], 340)
        self.assertEqual(overview["sections"]["basicOverview"]["hhldCnt"], 4)
        self.assertEqual(len(overview["sections"]["floorOverviews"]), 3)
        self.assertEqual(overview["sections"]["dongOverviews"][0]["grndFlrCnt"], 2)
        self.assertEqual(overview["sections"]["parking"]["plannedPkngCnt"], 4)
        self.assertTrue(overview["sections"]["parking"]["needsManualReview"])


if __name__ == "__main__":
    unittest.main()
