import unittest

from engine.regulation.building_use_appendix_parser import (
    parse_building_use_appendix_from_documents,
    parse_building_use_appendix_text,
)
from engine.regulation.law_document import LawDocument, LawDocumentSection
from engine.regulation.law_provider import LawProvider, LawProviderResponse
from engine.regulation.ordinance_engine import collect_law_references


class NotConfiguredProvider(LawProvider):
    provider_name = "test-law-provider"

    def is_configured(self) -> bool:
        return False

    def search_laws(self, query):
        return LawProviderResponse(
            provider=self.provider_name,
            status="skipped",
            message="not configured",
        )

    def fetch_law_body(self, reference):
        return LawProviderResponse(provider=self.provider_name, status="skipped")

    def fetch_law_articles(self, reference):
        return LawProviderResponse(provider=self.provider_name, status="skipped")

    def fetch_appendices(self, reference):
        return LawProviderResponse(provider=self.provider_name, status="skipped")


BUILDING_USE_APPENDIX_SAMPLE = """
■ 건축법 시행령 [별표 1]
용도별 건축물의 종류

1. 단독주택
  가. 단독주택
  나. 다중주택
  다. 다가구주택

2. 공동주택
  가. 아파트
  나. 연립주택
  다. 다세대주택
  라. 기숙사

3. 제1종 근린생활시설
  가. 식품ㆍ잡화ㆍ의류 등 일용품을 판매하는 소매점
  나. 휴게음식점

4. 제2종 근린생활시설
  가. 공연장
  나. 일반음식점

14. 업무시설
  가. 공공업무시설
  나. 일반업무시설
  다. 오피스텔
"""


class BuildingUseAppendixParserTest(unittest.TestCase):
    def test_parse_building_use_appendix_categories_and_subcategories(self):
        parsed = parse_building_use_appendix_text(BUILDING_USE_APPENDIX_SAMPLE)

        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["status"], "parsed")
        self.assertTrue(parsed["authoritative"])
        self.assertEqual(parsed["categoryCount"], 5)
        self.assertEqual(
            [category["name"] for category in parsed["categories"]],
            ["단독주택", "공동주택", "제1종 근린생활시설", "제2종 근린생활시설", "업무시설"],
        )
        office = next(category for category in parsed["categories"] if category["number"] == 14)
        self.assertTrue(any("오피스텔" in item["text"] for item in office["subcategories"]))
        self.assertGreaterEqual(parsed["seedCoverage"]["matchedCount"], 5)

    def test_parse_building_use_appendix_from_documents_prefers_appendix_candidate(self):
        document = LawDocument(
            reference={"url": "https://example.test/law"},
            title="건축법 시행령",
            provider="test",
            target="law",
            sections=[
                LawDocumentSection(
                    id="appendix-1",
                    section_type="appendix",
                    title="별표 1 건축물의 용도",
                    text=BUILDING_USE_APPENDIX_SAMPLE,
                    appendix="1",
                )
            ],
            appendix_count=1,
            article_count=0,
            body_text_length=len(BUILDING_USE_APPENDIX_SAMPLE),
        )

        parsed = parse_building_use_appendix_from_documents([document])

        self.assertEqual(parsed["status"], "parsed")
        self.assertEqual(parsed["source"]["lawTitle"], "건축법 시행령")
        self.assertEqual(parsed["source"]["sectionTitle"], "별표 1 건축물의 용도")

    def test_parse_building_use_appendix_from_documents_falls_back_to_seed(self):
        parsed = parse_building_use_appendix_from_documents([])

        self.assertEqual(parsed["status"], "seed-fallback")
        self.assertFalse(parsed["authoritative"])
        self.assertGreaterEqual(parsed["categoryCount"], 20)
        self.assertTrue(parsed["needsManualReview"])

    def test_collect_law_references_includes_seed_fallback_taxonomy_without_api(self):
        result = collect_law_references(
            {"address": "서울특별시 중구 세종대로 110"},
            provider=NotConfiguredProvider(),
        )

        self.assertEqual(result["status"], "fallback")
        self.assertEqual(result["buildingUseTaxonomy"]["status"], "seed-fallback")
        self.assertFalse(result["buildingUseTaxonomy"]["authoritative"])
        self.assertGreaterEqual(result["buildingUseTaxonomy"]["categoryCount"], 20)


if __name__ == "__main__":
    unittest.main()
