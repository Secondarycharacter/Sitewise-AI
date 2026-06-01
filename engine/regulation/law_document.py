"""Parse law.go.kr detail responses into searchable document sections."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any

from engine.regulation.law_provider import LawReference

ARTICLE_HINT_KEYS = ("조문", "조항", "항", "호", "목")
APPENDIX_HINT_KEYS = ("별표", "서식", "첨부", "부표")
TITLE_KEYS = (
    "법령명한글",
    "법령명",
    "자치법규명",
    "조례명",
    "별표제목",
    "별표명",
    "조문제목",
    "제목",
    "title",
)
TEXT_KEYS = (
    "조문내용",
    "항내용",
    "호내용",
    "목내용",
    "별표내용",
    "내용",
    "본문",
    "text",
)
NUMBER_KEYS = ("조문번호", "조문가지번호", "별표번호", "항번호", "호번호")
SECTION_TEXT_LIMITS = {
    "appendix": 80000,
    "article": 30000,
    "body": 30000,
}


@dataclass
class LawDocumentSection:
    id: str
    section_type: str
    title: str
    text: str
    article: str | None = None
    appendix: str | None = None
    source_path: str | None = None
    attachments: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {key: value for key, value in asdict(self).items() if value not in (None, "", [])}


@dataclass
class LawDocument:
    reference: dict[str, Any]
    title: str
    provider: str
    target: str
    sections: list[LawDocumentSection] = field(default_factory=list)
    appendix_count: int = 0
    article_count: int = 0
    body_text_length: int = 0
    parse_status: str = "parsed"
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "reference": self.reference,
            "title": self.title,
            "provider": self.provider,
            "target": self.target,
            "sections": [section.to_dict() for section in self.sections],
            "appendixCount": self.appendix_count,
            "articleCount": self.article_count,
            "bodyTextLength": self.body_text_length,
            "parseStatus": self.parse_status,
            "warnings": self.warnings,
        }


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("&nbsp;", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _first_text(item: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = item.get(key)
        text = _clean_text(value)
        if text:
            return text
    return None


def _collect_strings(value: Any, parent_key: str = "") -> list[str]:
    if isinstance(value, dict):
        parts: list[str] = []
        for key, nested in value.items():
            key_text = str(key)
            if key_text in ("조문여부", "삭제", "전문", "개정문"):
                continue
            parts.extend(_collect_strings(nested, key_text))
        return parts
    if isinstance(value, list):
        parts = []
        for item in value:
            parts.extend(_collect_strings(item, parent_key))
        return parts
    text = _clean_text(value)
    if not text:
        return []
    if parent_key and any(token in parent_key for token in ("파일", "링크", "URL", "url")):
        return []
    return [text]


def _collect_attachments(item: dict[str, Any]) -> list[str]:
    attachments: list[str] = []
    for key, value in item.items():
        key_text = str(key)
        if any(token in key_text for token in ("파일", "링크", "URL", "url")):
            text = _clean_text(value)
            if text:
                attachments.append(text)
    return attachments


def _section_kind(path: list[str], item: dict[str, Any]) -> str | None:
    keys = list(map(str, item.keys()))
    joined_keys = " ".join(keys)
    last_path = path[-1] if path else ""
    has_text_value = bool(_first_text(item, TEXT_KEYS) or _first_text(item, TITLE_KEYS))
    has_appendix_field = any("별표" in key or "첨부" in key or "서식" in key for key in keys)
    has_article_field = any("조문" in key or key in ("항내용", "호내용", "목내용") for key in keys)

    if has_text_value and (has_appendix_field or any(token in last_path for token in APPENDIX_HINT_KEYS)):
        return "appendix"
    if has_text_value and (has_article_field or any(token in last_path for token in ARTICLE_HINT_KEYS)):
        return "article"
    if has_text_value and any(key in joined_keys for key in TEXT_KEYS):
        return "body"
    return None


def _walk_sections(value: Any, path: list[str] | None = None) -> list[tuple[list[str], dict[str, Any]]]:
    path = path or []
    sections: list[tuple[list[str], dict[str, Any]]] = []

    if isinstance(value, list):
        for index, item in enumerate(value):
            sections.extend(_walk_sections(item, [*path, str(index)]))
        return sections

    if not isinstance(value, dict):
        return sections

    kind = _section_kind(path, value)
    if kind and _collect_strings(value):
        sections.append((path, value))

    for key, nested in value.items():
        if isinstance(nested, (dict, list)):
            sections.extend(_walk_sections(nested, [*path, str(key)]))

    return sections


def _make_section(
    path: list[str],
    item: dict[str, Any],
    index: int,
) -> LawDocumentSection | None:
    section_type = _section_kind(path, item) or "body"
    title = _first_text(item, TITLE_KEYS)
    number = _first_text(item, NUMBER_KEYS)
    text = _first_text(item, TEXT_KEYS)
    if not text:
        text = " ".join(_collect_strings(item))
    text = _clean_text(text)
    if not text:
        return None

    if not title:
        if section_type == "appendix":
            title = f"별표 {number or index + 1}"
        elif section_type == "article":
            title = f"조문 {number or index + 1}"
        else:
            title = f"본문 {index + 1}"

    identifier = f"{section_type}-{number or index + 1}"
    text_limit = SECTION_TEXT_LIMITS.get(section_type, 30000)
    return LawDocumentSection(
        id=identifier,
        section_type=section_type,
        title=title,
        text=text[:text_limit],
        article=number if section_type == "article" else None,
        appendix=number if section_type == "appendix" else None,
        source_path=".".join(path),
        attachments=_collect_attachments(item),
    )


def parse_law_document(reference: LawReference, detail_payload: dict[str, Any]) -> LawDocument:
    sections: list[LawDocumentSection] = []
    seen: set[tuple[str, str, str]] = set()

    for path, item in _walk_sections(detail_payload):
        section = _make_section(path, item, len(sections))
        if not section:
            continue
        key = (section.section_type, section.title, section.text[:200])
        if key in seen:
            continue
        seen.add(key)
        sections.append(section)

    warnings: list[str] = []
    if not sections:
        fallback_text = " ".join(_collect_strings(detail_payload))
        if fallback_text:
            sections.append(
                LawDocumentSection(
                    id="body-1",
                    section_type="body",
                    title=reference.title,
                    text=fallback_text[:12000],
                    source_path="root",
                )
            )
        else:
            warnings.append("법제처 상세 응답에서 검색 가능한 본문을 찾지 못했습니다.")

    article_count = len([section for section in sections if section.section_type == "article"])
    appendix_count = len([section for section in sections if section.section_type == "appendix"])
    body_text_length = sum(len(section.text) for section in sections)

    return LawDocument(
        reference=reference.to_dict(),
        title=reference.title,
        provider=reference.provider,
        target=reference.target,
        sections=sections,
        appendix_count=appendix_count,
        article_count=article_count,
        body_text_length=body_text_length,
        parse_status="parsed" if sections else "empty",
        warnings=warnings,
    )
