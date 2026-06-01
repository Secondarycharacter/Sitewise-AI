"""Fallback downloader for law.go.kr appendix popup pages."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urljoin

import requests

from engine.regulation.law_document import LawDocument, LawDocumentSection
from engine.regulation.law_provider import LawReference

LAW_WEB_ROOT = "https://www.law.go.kr/LSW/"


def _match_value(html: str, element_id: str) -> str | None:
    pattern = rf'id=["\']{re.escape(element_id)}["\'][^>]*value=["\']([^"\']+)["\']'
    match = re.search(pattern, html)
    return match.group(1) if match else None


def _selected_option(html: str) -> tuple[str | None, str | None]:
    match = re.search(
        r'<option[^>]*value=["\']([^"\']+)["\'][^>]*selected=["\']selected["\'][^>]*>(.*?)</option>',
        html,
        re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return None, None
    value = match.group(1)
    title = re.sub(r"<[^>]+>", " ", match.group(2))
    title = re.sub(r"\s+", " ", title).strip()
    return value, title


def _post_text_download(
    session: requests.Session,
    byl_seq: str,
    title: str,
    referer: str,
    timeout: int,
) -> requests.Response:
    return session.post(
        urljoin(LAW_WEB_ROOT, "ordinBylTextDownLoad.do"),
        data={"bylSeq": byl_seq, "title": title, "mode": "0"},
        headers={"Referer": referer, "User-Agent": "Mozilla/5.0"},
        timeout=timeout,
    )


def download_appendix_text_from_popup(
    reference: LawReference,
    timeout: int = 30,
) -> tuple[LawDocument | None, dict[str, Any]]:
    url = reference.url or ""
    if "ordinBylInfoPLinkR.do" not in url:
        return None, {
            "status": "skipped",
            "reason": "reference URL is not a law.go.kr ordinance appendix popup",
            "reference": reference.to_dict(),
        }

    session = requests.Session()
    try:
        popup = session.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=timeout)
        popup.raise_for_status()
        popup.encoding = "utf-8"
        popup_html = popup.text

        # The popup shell contains the selected appendix metadata. The actual text
        # is downloaded through the same endpoint used by the site's save button.
        option_value, selected_title = _selected_option(popup_html)
        byl_seq = _match_value(popup_html, "bylSeq")
        if option_value:
            byl_seq = option_value.split(",")[0] or byl_seq
        if not byl_seq:
            return None, {
                "status": "error",
                "reason": "bylSeq was not found in appendix popup",
                "reference": reference.to_dict(),
            }

        title = selected_title or reference.title
        text_response = _post_text_download(session, byl_seq, title, url, timeout)
        text_response.raise_for_status()
        text_response.encoding = "utf-8"
        text = text_response.text.strip()
        if not text:
            return None, {
                "status": "error",
                "reason": "appendix text download returned an empty body",
                "reference": reference.to_dict(),
                "bylSeq": byl_seq,
            }

        document = LawDocument(
            reference=reference.to_dict(),
            title=reference.title,
            provider=reference.provider,
            target=reference.target,
            sections=[
                LawDocumentSection(
                    id=f"appendix-{byl_seq}",
                    section_type="appendix",
                    title=title,
                    text=text[:12000],
                    appendix=byl_seq,
                    source_path=url,
                )
            ],
            appendix_count=1,
            article_count=0,
            body_text_length=len(text),
            parse_status="downloaded",
            warnings=[],
        )
        return document, {
            "status": "downloaded",
            "reference": reference.to_dict(),
            "bylSeq": byl_seq,
            "contentLength": len(text),
            "sourceUrl": url,
        }
    except Exception as exc:
        return None, {
            "status": "error",
            "reason": str(exc),
            "reference": reference.to_dict(),
            "sourceUrl": url,
        }
