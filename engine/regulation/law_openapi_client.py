"""법제처 Open API client used by the regulation engine."""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import requests
from dotenv import load_dotenv

from engine.regulation.law_provider import (
    LawProvider,
    LawProviderResponse,
    LawReference,
    LawSearchQuery,
)

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

LAW_SEARCH_URL = "https://www.law.go.kr/DRF/lawSearch.do"
LAW_SERVICE_URL = "https://www.law.go.kr/DRF/lawService.do"

TITLE_KEYS = (
    "법령명한글",
    "법령명",
    "자치법규명",
    "조례명",
    "ordinNm",
    "lawName",
    "title",
)
MST_KEYS = ("법령일련번호", "자치법규일련번호", "MST", "mst", "lawMst", "ordinMst")
ID_KEYS = ("법령ID", "자치법규ID", "ID", "id", "lawId", "ordinId")
EFFECTIVE_DATE_KEYS = ("시행일자", "시행일", "effectiveDate", "efYd")
PROMULGATION_DATE_KEYS = ("공포일자", "공포일", "promulgationDate", "ancYd")
URL_KEYS = ("상세링크", "법령상세링크", "url", "link")


def _first_value(item: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = item.get(key)
        if value not in (None, ""):
            return str(value).strip()
    return None


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _candidate_dicts(payload: Any) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []

    def visit(value: Any) -> None:
        if isinstance(value, list):
            for item in value:
                visit(item)
            return
        if not isinstance(value, dict):
            return

        if _first_value(value, TITLE_KEYS):
            candidates.append(value)

        for nested in value.values():
            if isinstance(nested, (dict, list)):
                visit(nested)

    visit(payload)
    return candidates


def _source_url(target: str, oc: str, reference_id: str | None = None, mst: str | None = None) -> str:
    params: dict[str, str] = {"OC": oc, "target": target, "type": "JSON"}
    if mst:
        params["MST"] = mst
    elif reference_id:
        params["ID"] = reference_id
    return f"{LAW_SERVICE_URL}?{urlencode(params)}"


class LawOpenApiProvider(LawProvider):
    provider_name = "law-openapi"

    def __init__(
        self,
        oc: str | None = None,
        timeout: int = 15,
        session: requests.Session | None = None,
    ) -> None:
        self.oc = (oc if oc is not None else os.getenv("LAW_OC", "")).strip()
        self.timeout = timeout
        self.session = session or requests.Session()

    def is_configured(self) -> bool:
        return bool(self.oc)

    def _not_configured(self, action: str) -> LawProviderResponse:
        return LawProviderResponse(
            provider=self.provider_name,
            status="skipped",
            message=f"{action}: LAW_OC 환경변수가 없어 법제처 Open API 조회를 건너뜁니다.",
        )

    def _request(self, url: str, params: dict[str, Any]) -> tuple[dict[str, Any], int]:
        started = time.monotonic()
        response = self.session.get(url, params=params, timeout=self.timeout)
        response.raise_for_status()
        elapsed_ms = int((time.monotonic() - started) * 1000)
        return response.json(), elapsed_ms

    def _error_response(
        self,
        action: str,
        error: Exception,
        query: dict[str, Any] | None = None,
    ) -> LawProviderResponse:
        return LawProviderResponse(
            provider=self.provider_name,
            status="error",
            query=query,
            message=f"{action}: 법제처 Open API 조회에 실패했습니다.",
            error=str(error),
        )

    def search_laws(self, query: LawSearchQuery) -> LawProviderResponse:
        if not self.is_configured():
            return self._not_configured(f"search:{query.query}")

        target = "ordin" if query.target == "ordinance" else query.target
        params = {
            "OC": self.oc,
            "target": target,
            "type": "JSON",
            "query": query.query,
            "display": str(max(1, min(query.display, 100))),
            "page": str(max(1, query.page)),
        }
        query_payload = {**query.to_dict(), "target": target}

        try:
            payload, elapsed_ms = self._request(LAW_SEARCH_URL, params)
        except Exception as exc:
            return self._error_response(f"search:{query.query}", exc, query_payload)

        references = self._references_from_search(payload, target, query)
        status = "ok" if references else "error"
        message = None if references else "법제처 검색 응답에서 법규 후보를 찾지 못했습니다."
        return LawProviderResponse(
            provider=self.provider_name,
            status=status,
            references=references,
            query=query_payload,
            message=message,
            elapsed_ms=elapsed_ms,
            raw_response=payload,
        )

    def _references_from_search(
        self,
        payload: dict[str, Any],
        target: str,
        query: LawSearchQuery,
    ) -> list[LawReference]:
        references: list[LawReference] = []
        jurisdiction_name = query.jurisdiction.display_name if query.jurisdiction else None

        for item in _candidate_dicts(payload):
            title = _first_value(item, TITLE_KEYS)
            if not title:
                continue
            mst = _first_value(item, MST_KEYS)
            law_id = _first_value(item, ID_KEYS)
            reference_id = mst or law_id
            direct_url = _first_value(item, URL_KEYS)
            url = direct_url or _source_url(target, self.oc, reference_id=law_id, mst=mst)
            references.append(
                LawReference(
                    id=reference_id,
                    title=title,
                    target=target,
                    provider=self.provider_name,
                    source_name="법제처 Open API",
                    mst=mst,
                    law_id=law_id,
                    effective_date=_first_value(item, EFFECTIVE_DATE_KEYS),
                    promulgation_date=_first_value(item, PROMULGATION_DATE_KEYS),
                    jurisdiction=jurisdiction_name,
                    url=url,
                    raw=item,
                )
            )

        deduped: list[LawReference] = []
        seen: set[tuple[str | None, str]] = set()
        for reference in references:
            key = (reference.id, reference.title)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(reference)
        return deduped

    def _fetch_detail(self, reference: LawReference, scope: str) -> LawProviderResponse:
        if not self.is_configured():
            return self._not_configured(f"{scope}:{reference.title}")

        params: dict[str, str] = {
            "OC": self.oc,
            "target": reference.target,
            "type": "JSON",
        }
        if reference.mst:
            params["MST"] = reference.mst
        elif reference.law_id:
            params["ID"] = reference.law_id
        elif reference.id:
            params["MST"] = reference.id
        else:
            return LawProviderResponse(
                provider=self.provider_name,
                status="error",
                references=[reference],
                message=f"{scope}: 원문 조회에 필요한 법규 식별자가 없습니다.",
            )

        try:
            payload, elapsed_ms = self._request(LAW_SERVICE_URL, params)
        except Exception as exc:
            return self._error_response(f"{scope}:{reference.title}", exc, reference.to_dict())

        enriched = LawReference(
            **{
                **reference.__dict__,
                "status": f"{scope}-fetched",
                "raw": {"search": reference.raw, "detail": payload},
            }
        )
        return LawProviderResponse(
            provider=self.provider_name,
            status="ok",
            references=[enriched],
            query={"scope": scope, **params},
            elapsed_ms=elapsed_ms,
            raw_response=payload,
        )

    def fetch_law_body(self, reference: LawReference) -> LawProviderResponse:
        return self._fetch_detail(reference, "body")

    def fetch_law_articles(self, reference: LawReference) -> LawProviderResponse:
        return self._fetch_detail(reference, "articles")

    def fetch_appendices(self, reference: LawReference) -> LawProviderResponse:
        return self._fetch_detail(reference, "appendices")
