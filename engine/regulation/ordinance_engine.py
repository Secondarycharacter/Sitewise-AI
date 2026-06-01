"""Collect official law and local ordinance references for regulation review."""

from __future__ import annotations

from typing import Any

from engine.regulation.article_appendix_linker import find_article_appendix_links
from engine.regulation.building_use_appendix_parser import parse_building_use_appendix_from_documents
from engine.regulation.jurisdiction_resolver import resolve_jurisdiction
from engine.regulation.law_appendix_downloader import download_appendix_text_from_popup
from engine.regulation.law_document_search import search_default_regulation_topics
from engine.regulation.law_document_store import LawDocumentStore
from engine.regulation.law_openapi_client import LawOpenApiProvider
from engine.regulation.law_provider import LawProvider, LawReference, LawSearchQuery
from engine.regulation.parking_rule_parser import parse_parking_rules_from_documents
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

APPENDIX_SEARCH_QUERIES = (
    ("부설주차장의 설치대상 시설물 종류 및 설치기준", "부설주차장 산정 별표", "parking_required_count"),
    ("대지안의 공지", "대지안의 공지 별표/서식", "setback"),
    ("대지의 조경", "조경 기준 별표/서식", "landscape"),
    ("용도지역별 건폐율 용적률", "건폐율/용적률 별표/서식", "zoning_limits"),
)

NATIONAL_APPENDIX_SEARCH_QUERIES = (
    ("건축법 시행령 건축물의 용도", "건축법 시행령 별표 1 건축물 용도 분류", "building_use_taxonomy"),
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


def _compact_text(value: str | None) -> str:
    return "".join(str(value or "").split())


def _raw_values(value: Any, limit: int = 40) -> list[str]:
    values: list[str] = []

    def visit(item: Any) -> None:
        if len(values) >= limit:
            return
        if isinstance(item, dict):
            for nested in item.values():
                visit(nested)
            return
        if isinstance(item, list):
            for nested in item:
                visit(nested)
            return
        text = str(item or "").strip()
        if text:
            values.append(text)

    visit(value)
    return values


def _reference_search_text(reference: LawReference) -> str:
    return " ".join(
        [
            reference.title,
            reference.url or "",
            reference.effective_date or "",
            reference.jurisdiction or "",
            *_raw_values(reference.raw),
        ]
    )


def _appendix_reference_score(
    reference: LawReference,
    purpose_key: str,
    jurisdiction_name: str = "",
) -> int:
    text = _reference_search_text(reference)
    compact = _compact_text(text)
    jurisdiction_compact = _compact_text(jurisdiction_name)
    score = 0

    if reference.target == "licbyl":
        score += 5

    if purpose_key == "building_use_taxonomy":
        if "건축법시행령" in compact:
            score += 60
        if "건축물의용도" in compact or "용도별건축물의종류" in compact:
            score += 50
        if "별표1" in compact or "[별표1]" in compact:
            score += 25
        if "건축법" in compact:
            score += 10
        if "조례" in compact:
            score -= 30
        if "주차" in compact:
            score -= 20
        return score

    if purpose_key == "parking_required_count":
        if jurisdiction_compact and jurisdiction_compact in compact:
            score += 20
        if "주차장설치및관리조례" in compact:
            score += 60
        if "부설주차장" in compact:
            score += 50
        if "설치대상시설물종류및설치기준" in compact:
            score += 45
        if "별표2" in compact or "[별표2]" in compact:
            score += 25
        if "설치제한" in compact:
            score -= 25
        return score

    generic_keywords = {
        "setback": ("대지안의공지", "공지"),
        "landscape": ("대지의조경", "조경"),
        "zoning_limits": ("용도지역별", "건폐율", "용적률"),
    }.get(purpose_key, ())
    for keyword in generic_keywords:
        if keyword in compact:
            score += 20
    if jurisdiction_compact and jurisdiction_compact in compact:
        score += 10
    return score


def _ranked_appendix_references(
    references: list[LawReference],
    purpose_key: str,
    jurisdiction_name: str = "",
    limit: int = 2,
) -> list[LawReference]:
    scored = [
        (reference, _appendix_reference_score(reference, purpose_key, jurisdiction_name))
        for reference in references
    ]
    positive = [(reference, score) for reference, score in scored if score > 0]
    candidates = positive or scored
    candidates.sort(key=lambda item: item[1], reverse=True)
    return [reference for reference, _score in candidates[:limit]]


def _ordinance_reference_score(
    reference: LawReference,
    purpose: str,
    jurisdiction_name: str = "",
) -> int:
    compact = _compact_text(_reference_search_text(reference))
    jurisdiction_compact = _compact_text(jurisdiction_name)
    score = 0
    if reference.target == "ordin":
        score += 10
    if jurisdiction_compact and compact.startswith(jurisdiction_compact):
        score += 20
    if "시행규칙" in compact:
        score -= 15

    if "주차장 설치 및 관리 조례" in purpose:
        expected = _compact_text(f"{jurisdiction_name} 주차장 설치 및 관리 조례")
        if expected and compact.startswith(expected):
            score += 100
        if "주차장설치및관리조례" in compact:
            score += 60
        if "주차장특별회계" in compact:
            score -= 25
    elif "건축 조례" in purpose:
        if "건축조례" in compact:
            score += 50
    elif "도시계획 조례" in purpose:
        if "도시계획조례" in compact:
            score += 50
    elif "녹지 조례" in purpose:
        if "녹지" in compact or "조경" in compact:
            score += 30
    return score


def _ranked_ordinance_references(
    references: list[LawReference],
    purpose: str,
    jurisdiction_name: str = "",
    limit: int = 3,
) -> list[LawReference]:
    scored = [
        (reference, _ordinance_reference_score(reference, purpose, jurisdiction_name))
        for reference in references
    ]
    positive = [(reference, score) for reference, score in scored if score > 0]
    candidates = positive or scored
    candidates.sort(key=lambda item: item[1], reverse=True)
    return [reference for reference, _score in candidates[:limit]]


def _reference_priority(reference: LawReference) -> int:
    title = reference.title
    compact = _compact_text(_reference_search_text(reference))
    score = 0
    if reference.target == "ordin":
        score += 5
    if "건축법시행령" in compact:
        score += 120
    if "주차장설치및관리조례" in compact:
        score += 100
    for keyword in ("건축물의 용도", "건축법 시행령", "주차", "건축 조례", "도시계획", "별표", "조경", "공지"):
        if keyword in title:
            score += 3
    if reference.target == "licbyl":
        score += max(
            _appendix_reference_score(reference, "building_use_taxonomy"),
            _appendix_reference_score(reference, "parking_required_count"),
            _appendix_reference_score(reference, "setback"),
            _appendix_reference_score(reference, "landscape"),
            _appendix_reference_score(reference, "zoning_limits"),
        )
    return score


def _document_summary(document: Any) -> dict[str, Any]:
    reference = document.reference or {}
    return {
        "title": document.title,
        "target": document.target,
        "provider": document.provider,
        "sectionCount": len(document.sections),
        "articleCount": document.article_count,
        "appendixCount": document.appendix_count,
        "bodyTextLength": document.body_text_length,
        "parseStatus": document.parse_status,
        "url": reference.get("url"),
        "effectiveDate": reference.get("effectiveDate"),
        "needsManualReview": True,
    }


def _collect_documents(
    references: list[LawReference],
    provider: LawProvider,
    max_documents: int = 8,
) -> tuple[list[Any], list[dict[str, Any]]]:
    store = LawDocumentStore()
    documents: list[Any] = []
    responses: list[dict[str, Any]] = []
    prioritized = sorted(references, key=_reference_priority, reverse=True)

    for reference in prioritized[:max_documents]:
        document, response = store.get_or_fetch(reference, provider)
        responses.append(response)
        if not document and reference.target == "licbyl":
            document, fallback_response = download_appendix_text_from_popup(reference)
            responses.append(fallback_response)
            if document:
                store.save(reference, document)
        if document:
            documents.append(document)
    return documents, responses


def _collect_appendix_references(
    jurisdiction_names: list[str],
    provider: LawProvider,
) -> tuple[list[LawReference], list[dict[str, Any]]]:
    references: list[LawReference] = []
    responses: list[dict[str, Any]] = []
    if not provider.is_configured():
        return references, responses

    for query_text, purpose, purpose_key in NATIONAL_APPENDIX_SEARCH_QUERIES:
        for search_scope in (2, 3):
            response = provider.search_laws(
                LawSearchQuery(
                    query=query_text,
                    target="licbyl",
                    search=search_scope,
                    display=5,
                )
            )
            selected = _ranked_appendix_references(
                response.references,
                purpose_key,
                limit=2,
            )
            responses.append(
                {
                    **response.to_dict(),
                    "purpose": purpose,
                    "purposeKey": purpose_key,
                    "searchScope": "해당법령검색" if search_scope == 2 else "별표본문검색",
                    "candidateCount": len(response.references),
                    "selectedReferences": [reference.to_dict() for reference in selected],
                }
            )
            references.extend(selected)

    for jurisdiction_name in jurisdiction_names:
        for query_text, purpose, purpose_key in APPENDIX_SEARCH_QUERIES:
            for search_scope in (2, 3):
                query = f"{jurisdiction_name} {query_text}".strip()
                response = provider.search_laws(
                    LawSearchQuery(
                        query=query,
                        target="licbyl",
                        search=search_scope,
                        display=5,
                    )
                )
                selected = _ranked_appendix_references(
                    response.references,
                    purpose_key,
                    jurisdiction_name=jurisdiction_name,
                    limit=2,
                )
                responses.append(
                    {
                        **response.to_dict(),
                        "purpose": purpose,
                        "purposeKey": purpose_key,
                        "jurisdictionQuery": jurisdiction_name,
                        "searchScope": "해당법령검색" if search_scope == 2 else "별표본문검색",
                        "candidateCount": len(response.references),
                        "selectedReferences": [reference.to_dict() for reference in selected],
                    }
                )
                references.extend(selected)
    return _dedupe_references(references), responses


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


def _jurisdiction_query_names(jurisdiction: Any) -> list[str]:
    names = [
        jurisdiction.display_name,
        jurisdiction.sido,
    ]
    return list(dict.fromkeys(name for name in names if name))


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
            "lawDocumentStatus": {
                "indexed": 0,
                "requested": 0,
                "hasAppendices": False,
                "needsManualReview": True,
            },
            "lawDocumentSummaries": [],
            "lawDocumentResponses": [],
            "lawSearchResults": [],
            "articleAppendixLinks": [],
            "buildingUseTaxonomy": parse_building_use_appendix_from_documents([]),
            "parkingRuleTables": [],
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

    local_prefixes = _jurisdiction_query_names(jurisdiction)
    for local_prefix in local_prefixes:
        for query_text, purpose in LOCAL_ORDINANCE_QUERIES:
            query = f"{local_prefix} {query_text}".strip()
            response = law_provider.search_laws(
                LawSearchQuery(
                    query=query,
                    target="ordin",
                    jurisdiction=jurisdiction,
                    display=50,
                )
            )
            selected = _ranked_ordinance_references(
                response.references,
                query_text,
                jurisdiction_name=local_prefix,
                limit=3,
            )
            provider_responses.append(
                {
                    **response.to_dict(),
                    "purpose": purpose,
                    "jurisdictionQuery": local_prefix,
                    "candidateCount": len(response.references),
                    "selectedReferences": [reference.to_dict() for reference in selected],
                }
            )
            references.extend(selected)

    references = _dedupe_references(references)
    appendix_references: list[LawReference] = []
    appendix_responses: list[dict[str, Any]] = []
    if references:
        appendix_references, appendix_responses = _collect_appendix_references(
            local_prefixes,
            law_provider,
        )
        provider_responses.extend(appendix_responses)

    all_references = _dedupe_references([*references, *appendix_references])
    documents: list[Any] = []
    document_responses: list[dict[str, Any]] = []
    search_results: list[dict[str, Any]] = []
    if all_references:
        documents, document_responses = _collect_documents(all_references, law_provider)
        search_results = search_default_regulation_topics(documents)
    article_appendix_links = find_article_appendix_links(documents)
    parking_rule_tables = parse_parking_rules_from_documents(documents)
    building_use_taxonomy = parse_building_use_appendix_from_documents(documents)

    article_documents = [document for document in documents if document.article_count > 0]
    appendix_documents = [document for document in documents if document.appendix_count > 0]

    status = "ok" if all_references else "fallback"
    message = None
    if not all_references:
        message = "법제처 Open API는 호출됐지만 법규 후보를 찾지 못해 fallback 규정표를 사용합니다."
    elif documents:
        status = "document-indexed"
        message = "법제처 법규 후보의 본문 조문을 먼저 확인하고, 관련 별표 후보까지 문서 캐시에 저장했습니다."
    else:
        message = "법규 후보는 찾았지만 상세 원문/별표 수집은 실패했거나 응답에 본문이 없었습니다."

    return {
        "status": status,
        "provider": law_provider.provider_name,
        "jurisdiction": jurisdiction.to_dict(),
        "lawReferences": [reference.to_dict() for reference in all_references],
        "articleReferences": [reference.to_dict() for reference in references],
        "appendixReferences": [reference.to_dict() for reference in appendix_references],
        "structuredRuleDrafts": _draft_rules_from_references(all_references),
        "lawDocumentStatus": {
            "indexed": len(documents),
            "requested": min(len(all_references), 8),
            "articleIndexed": len(article_documents),
            "appendixIndexed": len(appendix_documents),
            "hasAppendices": len(appendix_documents) > 0,
            "needsManualReview": True,
        },
        "lawDocumentSummaries": [_document_summary(document) for document in documents],
        "lawDocumentResponses": document_responses,
        "lawSearchResults": search_results,
        "articleAppendixLinks": article_appendix_links,
        "buildingUseTaxonomy": building_use_taxonomy,
        "parkingRuleTables": parking_rule_tables,
        "providerResponses": provider_responses,
        "needsManualReview": True,
        "message": message,
    }
