"""Provider interfaces for official Korean law and ordinance lookups."""

from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from typing import Any, Literal


LawTarget = Literal["law", "ordin", "admRul", "ordinance"]
ProviderStatus = Literal["ok", "skipped", "error"]


@dataclass
class Jurisdiction:
    sido: str | None = None
    sigungu: str | None = None
    source_address: str | None = None
    confidence: str = "low"
    warnings: list[str] = field(default_factory=list)

    @property
    def display_name(self) -> str:
        return " ".join(part for part in (self.sido, self.sigungu) if part).strip()

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["displayName"] = self.display_name
        return {key: value for key, value in payload.items() if value not in (None, [], "")}


@dataclass
class LawSearchQuery:
    query: str
    target: LawTarget = "law"
    jurisdiction: Jurisdiction | None = None
    display: int = 10
    page: int = 1

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        if self.jurisdiction:
            payload["jurisdiction"] = self.jurisdiction.to_dict()
        return payload


@dataclass
class LawReference:
    id: str | None
    title: str
    target: str
    provider: str
    source_name: str
    mst: str | None = None
    law_id: str | None = None
    article: str | None = None
    appendix: str | None = None
    effective_date: str | None = None
    promulgation_date: str | None = None
    jurisdiction: str | None = None
    url: str | None = None
    confidence: str = "candidate"
    needs_manual_review: bool = True
    status: str = "referenced"
    error: str | None = None
    raw: dict[str, Any] | None = None

    def to_dict(self, include_raw: bool = False) -> dict[str, Any]:
        payload = {
            "id": self.id,
            "title": self.title,
            "target": self.target,
            "provider": self.provider,
            "sourceName": self.source_name,
            "mst": self.mst,
            "lawId": self.law_id,
            "article": self.article,
            "appendix": self.appendix,
            "effectiveDate": self.effective_date,
            "promulgationDate": self.promulgation_date,
            "jurisdiction": self.jurisdiction,
            "url": self.url,
            "confidence": self.confidence,
            "needsManualReview": self.needs_manual_review,
            "status": self.status,
            "error": self.error,
        }
        if include_raw and self.raw is not None:
            payload["raw"] = self.raw
        return {key: value for key, value in payload.items() if value not in (None, "", [])}


@dataclass
class LawProviderResponse:
    provider: str
    status: ProviderStatus
    references: list[LawReference] = field(default_factory=list)
    query: dict[str, Any] | None = None
    message: str | None = None
    error: str | None = None
    elapsed_ms: int | None = None
    raw_response: dict[str, Any] | None = None

    def to_dict(self, include_raw: bool = False) -> dict[str, Any]:
        payload = {
            "provider": self.provider,
            "status": self.status,
            "references": [ref.to_dict(include_raw=include_raw) for ref in self.references],
            "query": self.query,
            "message": self.message,
            "error": self.error,
            "elapsedMs": self.elapsed_ms,
        }
        if include_raw and self.raw_response is not None:
            payload["rawResponse"] = self.raw_response
        return {key: value for key, value in payload.items() if value not in (None, [], {})}


class LawProvider(ABC):
    """Common surface for Open API and future MCP adapters."""

    provider_name: str

    @abstractmethod
    def is_configured(self) -> bool:
        raise NotImplementedError

    @abstractmethod
    def search_laws(self, query: LawSearchQuery) -> LawProviderResponse:
        raise NotImplementedError

    @abstractmethod
    def fetch_law_body(self, reference: LawReference) -> LawProviderResponse:
        raise NotImplementedError

    @abstractmethod
    def fetch_law_articles(self, reference: LawReference) -> LawProviderResponse:
        raise NotImplementedError

    @abstractmethod
    def fetch_appendices(self, reference: LawReference) -> LawProviderResponse:
        raise NotImplementedError


class KoreanLawMcpProvider(LawProvider):
    """Future adapter placeholder using the same provider contract."""

    provider_name = "korean-law-mcp"

    def is_configured(self) -> bool:
        return False

    def _skipped(self, action: str) -> LawProviderResponse:
        return LawProviderResponse(
            provider=self.provider_name,
            status="skipped",
            message=f"{action}: MCP runtime adapter is not connected yet.",
        )

    def search_laws(self, query: LawSearchQuery) -> LawProviderResponse:
        return self._skipped(f"search:{query.query}")

    def fetch_law_body(self, reference: LawReference) -> LawProviderResponse:
        return self._skipped(f"body:{reference.title}")

    def fetch_law_articles(self, reference: LawReference) -> LawProviderResponse:
        return self._skipped(f"articles:{reference.title}")

    def fetch_appendices(self, reference: LawReference) -> LawProviderResponse:
        return self._skipped(f"appendices:{reference.title}")
