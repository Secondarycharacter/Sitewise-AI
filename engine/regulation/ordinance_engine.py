"""Collect official law and local ordinance references for regulation review."""

from __future__ import annotations

from typing import Any

from engine.regulation.jurisdiction_resolver import resolve_jurisdiction
from engine.regulation.law_openapi_client import LawOpenApiProvider
from engine.regulation.law_provider import LawProvider, LawReference, LawSearchQuery
from engine.regulation.rule_schema import RegulationSource, StructuredRuleDraft

NATIONAL_LAW_QUERIES = (
    ("국토의 계획 및 이용에 관한 법률 시행령", "용도지역별 건폐율/용적률 상한의 상위 법령"),
    ("건축법", "건축 계획 기본 법령"),
    ("주차장법", "주차장 설치 기준 상위 법령"),
)

LOCAL_ORDINANCE_QUERIES = (
    ("도시계획 조례", "용도지역별 건폐율/용적률 세부 기준"),
    ("건축 조례", "대지안의 공지/조경 등 건축 세부 기준"),
    ("주차장 설치 및 관리 조례", "용도별 부설주차장 설치 기준"),
    ("녹지 조례", "조경/녹지 관련 후보 조례"),
)


def _dedupe_references(references: list[LawReference]) -> list[LawReference]:
    deduped: list[LawReference] = []
    seen: set[tuple[str | None, str, str]] = set()
    for reference in references:
        key = (reference.id, reference.title, reference.target)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(reference)
    return deduped


def _draft_rules_from_references(references: list[LawReference]) -> list[dict[str, Any]]:
    drafts: list[StructuredRuleDraft] = []

    for reference in references:
        title = reference.title
        lower_title = title.lower()
        source = RegulationSource(
            name=reference.source_name,
            provider=reference.provider,
            source_type=reference.target,
            status=reference.status,
            title=reference.title,
            effective_date=reference.effective_date,
            url=reference.url,
            confidence=reference.confidence,
            needs_manual_review=reference.needs_manual_review,
        )

        if "도시계획" in title or "국토의 계획" in title:
            drafts.append(
                StructuredRuleDraft(
                    key="zoning_limits",
                    label="건폐율/용적률 후보 기준",
                    source=source,
                    notes=["별표/조문 수치 파싱은 2차 구현에서 계산 규칙으로 전환합니다."],
                )
            )
        elif "주차" in title or "parking" in lower_title:
            drafts.append(
                StructuredRuleDraft(
                    key="parking_requirements",
                    label="부설주차장 설치 후보 기준",
                    source=source,
                    notes=["용도별 주차대수 산정식은 원문 확인 후 구조화가 필요합니다."],
                )
            )
        elif "건축" in title:
            drafts.append(
                StructuredRuleDraft(
                    key="building_ordinance",
                    label="건축 조례 후보 기준",
                    source=source,
                    notes=["대지안의 공지/조경/높이 등 세부 항목은 수동 확인이 필요합니다."],
                )
            )

    return [draft.to_dict() for draft in drafts]


def collect_law_references(
    parcel: dict[str, Any],
    provider: LawProvider | None = None,
) -> dict[str, Any]:
    jurisdiction = resolve_jurisdiction(parcel)
    law_provider = provider or LawOpenApiProvider()

    provider_responses: list[dict[str, Any]] = []
    references: list[LawReference] = []

    if not law_provider.is_configured():
        response = law_provider.search_laws(
            LawSearchQuery(query="법제처 Open API 설정 확인", jurisdiction=jurisdiction)
        )
        return {
            "status": "fallback",
            "provider": law_provider.provider_name,
            "jurisdiction": jurisdiction.to_dict(),
            "lawReferences": [],
            "structuredRuleDrafts": [],
            "providerResponses": [response.to_dict()],
            "needsManualReview": True,
            "message": "LAW_OC 환경변수가 없어 기존 fallback 규정표를 사용합니다.",
        }

    for query_text, purpose in NATIONAL_LAW_QUERIES:
        response = law_provider.search_laws(
            LawSearchQuery(
                query=query_text,
                target="law",
                jurisdiction=jurisdiction,
                display=5,
            )
        )
        provider_responses.append({**response.to_dict(), "purpose": purpose})
        references.extend(response.references[:2])

    local_prefix = jurisdiction.display_name
    for query_text, purpose in LOCAL_ORDINANCE_QUERIES:
        query = f"{local_prefix} {query_text}".strip()
        response = law_provider.search_laws(
            LawSearchQuery(
                query=query,
                target="ordin",
                jurisdiction=jurisdiction,
                display=5,
            )
        )
        provider_responses.append({**response.to_dict(), "purpose": purpose})
        references.extend(response.references[:3])

    references = _dedupe_references(references)
    status = "ok" if references else "fallback"
    message = None
    if not references:
        message = "법제처 Open API는 호출됐지만 법규 후보를 찾지 못해 fallback 규정표를 사용합니다."

    return {
        "status": status,
        "provider": law_provider.provider_name,
        "jurisdiction": jurisdiction.to_dict(),
        "lawReferences": [reference.to_dict() for reference in references],
        "structuredRuleDrafts": _draft_rules_from_references(references),
        "providerResponses": provider_responses,
        "needsManualReview": True,
        "message": message,
    }
