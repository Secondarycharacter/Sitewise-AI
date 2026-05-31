"""공식 법규 조회 결과를 계산 가능한 규칙으로 전환하기 위한 공통 스키마."""

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class RegulationSource:
    name: str
    provider: str
    source_type: str
    status: str
    title: str | None = None
    article: str | None = None
    appendix: str | None = None
    effective_date: str | None = None
    url: str | None = None
    confidence: str = "candidate"
    needs_manual_review: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {key: value for key, value in asdict(self).items() if value is not None}


@dataclass
class StructuredRuleDraft:
    """1차 구현에서는 원문 참조와 계산 후보를 분리해서 보관한다."""

    key: str
    label: str
    value: float | str | None = None
    unit: str | None = None
    source: RegulationSource | None = None
    confidence: str = "candidate"
    needs_manual_review: bool = True
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        payload = {
            "key": self.key,
            "label": self.label,
            "value": self.value,
            "unit": self.unit,
            "confidence": self.confidence,
            "needsManualReview": self.needs_manual_review,
            "notes": self.notes,
        }
        if self.source:
            payload["source"] = self.source.to_dict()
        return {key: value for key, value in payload.items() if value not in (None, [], {})}
