"""Client skeleton for 토지이음/토지이용규제정보서비스.

The public service is exposed through data.go.kr and returns XML. The exact
operation set can vary by approved service, so the client keeps raw responses
and never blocks the planning pipeline when the key or endpoint is unavailable.
"""

from __future__ import annotations

import os
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

DEFAULT_LAND_USE_RESTRICTION_URL = (
    "http://apis.data.go.kr/1613000/LuplStat/getLuplStatList"
)


def _xml_to_dict(element: ET.Element) -> dict[str, Any] | str:
    children = list(element)
    if not children:
        return (element.text or "").strip()

    payload: dict[str, Any] = {}
    for child in children:
        value = _xml_to_dict(child)
        if child.tag in payload:
            current = payload[child.tag]
            if not isinstance(current, list):
                payload[child.tag] = [current]
            payload[child.tag].append(value)
        else:
            payload[child.tag] = value
    return payload


class EumClient:
    provider_name = "data-go-kr-eum"

    def __init__(
        self,
        service_key: str | None = None,
        restriction_url: str | None = None,
        timeout: int = 20,
        session: requests.Session | None = None,
    ) -> None:
        self.service_key = (
            service_key if service_key is not None else os.getenv("EUM_SERVICE_KEY", "")
        ).strip()
        self.restriction_url = (
            restriction_url
            or os.getenv("EUM_LAND_USE_RESTRICTION_URL", "")
            or DEFAULT_LAND_USE_RESTRICTION_URL
        )
        self.timeout = timeout
        self.session = session or requests.Session()

    def is_configured(self) -> bool:
        return bool(self.service_key)

    def fetch_land_use_restrictions(self, pnu: str | None) -> dict[str, Any]:
        if not self.is_configured():
            return {
                "provider": self.provider_name,
                "status": "skipped",
                "message": "EUM_SERVICE_KEY가 없어 토지이음 행위제한 API 조회를 건너뜁니다.",
            }
        if not pnu:
            return {
                "provider": self.provider_name,
                "status": "skipped",
                "message": "PNU가 없어 토지이음 행위제한 API 조회를 건너뜁니다.",
            }

        params = {
            "serviceKey": self.service_key,
            "pnu": pnu,
            "numOfRows": "100",
            "pageNo": "1",
        }
        started = time.monotonic()
        try:
            response = self.session.get(
                self.restriction_url,
                params=params,
                timeout=self.timeout,
            )
            response.raise_for_status()
            response.encoding = response.encoding or "utf-8"
            root = ET.fromstring(response.text)
            payload = _xml_to_dict(root)
            return {
                "provider": self.provider_name,
                "status": "ok",
                "elapsedMs": int((time.monotonic() - started) * 1000),
                "query": {"pnu": pnu, "url": self.restriction_url},
                "raw": payload,
            }
        except Exception as exc:
            return {
                "provider": self.provider_name,
                "status": "error",
                "query": {"pnu": pnu, "url": self.restriction_url},
                "error": str(exc),
                "message": "토지이음 행위제한 API 조회에 실패했습니다.",
            }
