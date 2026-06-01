"""Parse Building Act Enforcement Decree Appendix 1 use classifications."""

from __future__ import annotations

import re
from typing import Any

from engine.regulation.building_use_classifier import SOURCE, USE_CATEGORIES
from engine.regulation.law_document import LawDocument


def _clean(text: str) -> str:
    text = re.sub(r"[┃┏┓┗┛┣┫┠┨┯┷┿┼━─]", " ", text)
    text = re.sub(r"[\[\]',]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _normalize_name(text: str) -> str:
    return re.sub(r"[\s·ㆍ,()（）\[\]{}「」『』`\"']", "", text or "")


def _split_categories(text: str) -> list[tuple[int, str, str]]:
    normalized = _clean(text)
    category_names = sorted(
        [re.escape(str(category["name"])) for category in USE_CATEGORIES],
        key=len,
        reverse=True,
    )
    pattern = re.compile(rf"(?<!제)(\d{{1,2}})\.\s*({'|'.join(category_names)})")
    matches = list(pattern.finditer(normalized))
    categories: list[tuple[int, str, str]] = []

    for index, match in enumerate(matches):
        number = int(match.group(1))
        title = _clean(match.group(2))
        end = matches[index + 1].start() if index + 1 < len(matches) else len(normalized)
        body = normalized[match.end() : end].strip()
        if 1 <= number <= 40 and title:
            categories.append((number, title, body))

    return categories


def _parse_subcategories(body: str) -> list[dict[str, str]]:
    subcategories: list[dict[str, str]] = []
    pattern = re.compile(r"([가-힣])\.\s*([^가-힣]*?[가-힣A-Za-z0-9·ㆍ\s]+?)(?=\s+[가-힣]\.|$)")
    for match in pattern.finditer(body):
        label = match.group(1)
        text = _clean(match.group(2))
        if text:
            subcategories.append({"label": label, "text": text[:400]})
    return subcategories


def parse_building_use_appendix_text(
    text: str,
    source: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    if "건축물의 용도" not in text and "단독주택" not in text and "공동주택" not in text:
        return None

    categories = []
    for number, title, body in _split_categories(text):
        categories.append(
            {
                "number": number,
                "name": title,
                "normalizedName": _normalize_name(title),
                "subcategories": _parse_subcategories(body),
                "rawText": body[:1200],
            }
        )

    if not categories:
        return None

    parsed_names = {category["normalizedName"] for category in categories}
    matched_seed = [
        {
            "number": seed["number"],
            "name": seed["name"],
            "foundInAppendix": _normalize_name(seed["name"]) in parsed_names,
        }
        for seed in USE_CATEGORIES
    ]

    return {
        "source": source or {},
        "sourceLabel": SOURCE,
        "status": "parsed",
        "authoritative": True,
        "categoryCount": len(categories),
        "categories": categories,
        "seedCoverage": {
            "seedCount": len(USE_CATEGORIES),
            "matchedCount": sum(1 for item in matched_seed if item["foundInAppendix"]),
            "items": matched_seed,
        },
        "needsManualReview": True,
    }


def parse_building_use_appendix_from_documents(documents: list[LawDocument]) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = []

    for document in documents:
        for section in document.sections:
            combined = f"{document.title} {section.title} {section.text}"
            if "건축물의 용도" not in combined and "건축법 시행령" not in document.title:
                continue
            result = parse_building_use_appendix_text(
                section.text,
                source={
                    "lawTitle": document.title,
                    "sectionTitle": section.title,
                    "sectionId": section.id,
                    "url": (document.reference or {}).get("url"),
                    "effectiveDate": (document.reference or {}).get("effectiveDate"),
                    "parseStatus": document.parse_status,
                },
            )
            if result:
                candidates.append(result)

    if candidates:
        candidates.sort(key=lambda item: item.get("categoryCount") or 0, reverse=True)
        return candidates[0]

    return {
        "sourceLabel": SOURCE,
        "status": "seed-fallback",
        "authoritative": False,
        "categoryCount": len(USE_CATEGORIES),
        "categories": [
            {
                "number": item["number"],
                "name": item["name"],
                "normalizedName": _normalize_name(item["name"]),
                "parkingCategory": item["parkingCategory"],
            }
            for item in USE_CATEGORIES
        ],
        "seedCoverage": {
            "seedCount": len(USE_CATEGORIES),
            "matchedCount": 0,
            "items": [],
        },
        "needsManualReview": True,
        "message": "건축법 시행령 별표 1 원문을 아직 수집하지 못해 seed taxonomy를 사용합니다.",
    }
