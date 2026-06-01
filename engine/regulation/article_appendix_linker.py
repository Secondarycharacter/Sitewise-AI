"""Link ordinance articles to referenced appendices."""

from __future__ import annotations

import re
from typing import Any

from engine.regulation.law_document import LawDocument, LawDocumentSection


def _appendix_numbers(text: str) -> list[str]:
    return list(dict.fromkeys(re.findall(r"별표\s*(\d+)", text or "")))


def _article_numbers(text: str) -> list[str]:
    return list(dict.fromkeys(re.findall(r"제\s*(\d+)\s*조", text or "")))


def _section_payload(document: LawDocument, section: LawDocumentSection) -> dict[str, Any]:
    reference = document.reference or {}
    return {
        "lawTitle": document.title,
        "sectionId": section.id,
        "sectionType": section.section_type,
        "sectionTitle": section.title,
        "article": section.article,
        "appendix": section.appendix,
        "url": reference.get("url"),
        "effectiveDate": reference.get("effectiveDate"),
    }


def find_article_appendix_links(documents: list[LawDocument]) -> list[dict[str, Any]]:
    articles: list[tuple[LawDocument, LawDocumentSection]] = []
    appendices: list[tuple[LawDocument, LawDocumentSection]] = []

    for document in documents:
        for section in document.sections:
            if section.section_type == "article":
                articles.append((document, section))
            elif section.section_type == "appendix":
                appendices.append((document, section))

    links: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str | None]] = set()

    for article_document, article in articles:
        article_text = f"{article.title} {article.text}"
        for appendix_number in _appendix_numbers(article_text):
            matched_appendices = [
                (document, appendix)
                for document, appendix in appendices
                if appendix_number in _appendix_numbers(f"{appendix.title} {appendix.text}")
                or appendix.appendix == appendix_number
                or f"별표 {appendix_number}" in appendix.title
            ]
            for appendix_document, appendix in matched_appendices:
                key = (article.id, appendix.id, appendix_number)
                if key in seen:
                    continue
                seen.add(key)
                links.append(
                    {
                        "linkType": "article-references-appendix",
                        "appendixNumber": appendix_number,
                        "article": _section_payload(article_document, article),
                        "appendix": _section_payload(appendix_document, appendix),
                        "confidence": "high",
                        "needsManualReview": True,
                    }
                )

    for appendix_document, appendix in appendices:
        appendix_text = f"{appendix.title} {appendix.text}"
        for article_number in _article_numbers(appendix_text):
            matched_articles = [
                (document, article)
                for document, article in articles
                if article.article == article_number
                or f"제{article_number}조" in article.title
                or f"제{article_number}조" in article.text
            ]
            for article_document, article in matched_articles:
                key = (article.id, appendix.id, appendix.appendix or appendix.id)
                if key in seen:
                    continue
                seen.add(key)
                links.append(
                    {
                        "linkType": "appendix-title-references-article",
                        "appendixNumber": (appendix.appendix or _appendix_numbers(appendix_text) or [None])[0],
                        "article": _section_payload(article_document, article),
                        "appendix": _section_payload(appendix_document, appendix),
                        "confidence": "medium",
                        "needsManualReview": True,
                    }
                )

    return links
