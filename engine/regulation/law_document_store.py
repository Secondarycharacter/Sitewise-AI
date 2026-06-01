"""Local cache for parsed law documents."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from engine.regulation.law_document import LawDocument, parse_law_document
from engine.regulation.law_provider import LawProvider, LawReference

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CACHE_DIR = ROOT / ".fam-cache" / "law_documents"
CACHE_VERSION = 2


def _cache_key(reference: LawReference) -> str:
    raw = "|".join(
        [
            reference.provider or "",
            reference.target or "",
            reference.id or "",
            reference.mst or "",
            reference.law_id or "",
            reference.title or "",
        ]
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def _document_from_dict(payload: dict[str, Any]) -> LawDocument:
    from engine.regulation.law_document import LawDocumentSection

    sections = [
        LawDocumentSection(
            id=str(section.get("id") or f"section-{index + 1}"),
            section_type=str(section.get("section_type") or section.get("sectionType") or "body"),
            title=str(section.get("title") or ""),
            text=str(section.get("text") or ""),
            article=section.get("article"),
            appendix=section.get("appendix"),
            source_path=section.get("source_path") or section.get("sourcePath"),
            attachments=list(section.get("attachments") or []),
        )
        for index, section in enumerate(payload.get("sections") or [])
    ]
    return LawDocument(
        reference=dict(payload.get("reference") or {}),
        title=str(payload.get("title") or ""),
        provider=str(payload.get("provider") or ""),
        target=str(payload.get("target") or ""),
        sections=sections,
        appendix_count=int(payload.get("appendixCount") or payload.get("appendix_count") or 0),
        article_count=int(payload.get("articleCount") or payload.get("article_count") or 0),
        body_text_length=int(payload.get("bodyTextLength") or payload.get("body_text_length") or 0),
        parse_status=str(payload.get("parseStatus") or payload.get("parse_status") or "parsed"),
        warnings=list(payload.get("warnings") or []),
    )


class LawDocumentStore:
    def __init__(self, cache_dir: Path | None = None) -> None:
        self.cache_dir = cache_dir or DEFAULT_CACHE_DIR

    def _path_for(self, reference: LawReference) -> Path:
        return self.cache_dir / f"{_cache_key(reference)}.json"

    def load(self, reference: LawReference) -> LawDocument | None:
        path = self._path_for(reference)
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if int(payload.get("cacheVersion") or 0) < CACHE_VERSION:
                return None
            return _document_from_dict(payload.get("document") or payload)
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            return None

    def save(self, reference: LawReference, document: LawDocument) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        payload = {
            "cacheVersion": CACHE_VERSION,
            "cachedAt": datetime.now(timezone.utc).isoformat(),
            "cacheKey": _cache_key(reference),
            "document": document.to_dict(),
        }
        self._path_for(reference).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def get_or_fetch(
        self,
        reference: LawReference,
        provider: LawProvider,
        refresh: bool = False,
    ) -> tuple[LawDocument | None, dict[str, Any]]:
        if not refresh:
            cached = self.load(reference)
            if cached:
                return cached, {"status": "cached", "reference": reference.to_dict()}

        response = provider.fetch_law_body(reference)
        if response.status != "ok" or not response.raw_response:
            return None, response.to_dict()

        document = parse_law_document(reference, response.raw_response)
        self.save(reference, document)
        return document, response.to_dict()
