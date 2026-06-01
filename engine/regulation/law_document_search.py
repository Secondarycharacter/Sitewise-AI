"""Natural-language style search over parsed law document sections."""

from __future__ import annotations

import re
from typing import Any

from engine.regulation.law_document import LawDocument, LawDocumentSection

DOMAIN_SYNONYMS = {
    "건폐율": ["건폐율", "건축면적", "대지면적"],
    "용적률": ["용적률", "연면적", "지상층", "산정"],
    "주차": ["주차", "부설주차장", "주차대수", "주차장", "대수", "주차구획"],
    "공지": ["대지안의 공지", "공지", "인접대지", "이격", "대지경계선"],
    "조경": ["조경", "식재", "녹지", "대지의 조경"],
    "램프": ["경사로", "램프", "차로", "통로", "경사도"],
}

DEFAULT_REGULATION_QUERIES = (
    "용도지역별 건폐율 용적률 기준",
    "부설주차장 용도별 주차대수 산정 기준 별표",
    "대지안의 공지 인접대지경계선 이격거리 기준",
    "대지의 조경 식재 녹지 기준",
)


def _tokenize(query: str) -> list[str]:
    tokens = re.findall(r"[0-9A-Za-z가-힣]+", query.lower())
    expanded: list[str] = []
    for token in tokens:
        expanded.append(token)
        for keyword, synonyms in DOMAIN_SYNONYMS.items():
            if token in keyword.lower() or keyword.lower() in token:
                expanded.extend(synonym.lower() for synonym in synonyms)
    return [token for token in dict.fromkeys(expanded) if len(token) >= 2]


def _snippet(text: str, terms: list[str], size: int = 180) -> str:
    lowered = text.lower()
    hit_positions = [lowered.find(term) for term in terms if lowered.find(term) >= 0]
    start = max(0, min(hit_positions) - 60) if hit_positions else 0
    snippet = text[start : start + size].strip()
    if start > 0:
        snippet = f"...{snippet}"
    if start + size < len(text):
        snippet = f"{snippet}..."
    return snippet


def _score_section(section: LawDocumentSection, terms: list[str]) -> int:
    haystack = f"{section.title} {section.text}".lower()
    score = 0
    for term in terms:
        count = haystack.count(term)
        if count:
            score += count
            if term in section.title.lower():
                score += 3
    if section.section_type == "appendix":
        score += 2
    if any(term in haystack for term in ("별표", "산정", "기준", "이상", "이하")):
        score += 1
    return score


def search_law_documents(
    documents: list[LawDocument],
    query: str,
    limit: int = 5,
) -> list[dict[str, Any]]:
    terms = _tokenize(query)
    if not terms:
        return []

    scored: list[tuple[int, LawDocument, LawDocumentSection]] = []
    for document in documents:
        for section in document.sections:
            score = _score_section(section, terms)
            if score > 0:
                scored.append((score, document, section))

    scored.sort(key=lambda item: item[0], reverse=True)
    results: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for score, document, section in scored:
        key = (document.title, section.id)
        if key in seen:
            continue
        seen.add(key)
        reference = document.reference or {}
        results.append(
            {
                "query": query,
                "score": score,
                "lawTitle": document.title,
                "sectionId": section.id,
                "sectionType": section.section_type,
                "sectionTitle": section.title,
                "snippet": _snippet(section.text, terms),
                "attachments": section.attachments,
                "reference": {
                    "id": reference.get("id"),
                    "title": reference.get("title") or document.title,
                    "target": reference.get("target"),
                    "url": reference.get("url"),
                    "effectiveDate": reference.get("effectiveDate"),
                },
                "needsManualReview": True,
            }
        )
        if len(results) >= limit:
            break
    return results


def search_default_regulation_topics(documents: list[LawDocument]) -> list[dict[str, Any]]:
    grouped: list[dict[str, Any]] = []
    for query in DEFAULT_REGULATION_QUERIES:
        grouped.append(
            {
                "query": query,
                "results": search_law_documents(documents, query, limit=4),
            }
        )
    return grouped
