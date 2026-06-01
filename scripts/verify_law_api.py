"""Verify law.go.kr Open API collection without printing credentials.

Usage:
    python scripts/verify_law_api.py --address "서울특별시 중구 세종대로 110"
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine.regulation.law_config import is_law_oc_configured
from engine.regulation.ordinance_engine import collect_law_references


def _reference_summary(reference: dict[str, Any]) -> dict[str, Any]:
    return {
        key: reference.get(key)
        for key in ("title", "target", "sourceName", "effectiveDate", "status", "confidence")
        if reference.get(key)
    }


def _response_summary(response: dict[str, Any]) -> dict[str, Any]:
    selected = [
        _reference_summary(reference)
        for reference in response.get("selectedReferences") or []
    ]
    payload = {
        "purpose": response.get("purpose"),
        "purposeKey": response.get("purposeKey"),
        "searchScope": response.get("searchScope"),
        "status": response.get("status"),
        "candidateCount": response.get("candidateCount"),
        "selectedReferences": selected,
        "message": response.get("message"),
        "error": response.get("error"),
        "elapsedMs": response.get("elapsedMs"),
    }
    return {key: value for key, value in payload.items() if value not in (None, "", [], {})}


def build_summary(address: str) -> dict[str, Any]:
    configured = is_law_oc_configured()
    if not configured:
        return {
            "configured": False,
            "status": "skipped",
            "message": "LAW_OC is not configured in environment/.env or .cursor/mcp.json.",
        }

    result = collect_law_references({"address": address})
    taxonomy = result.get("buildingUseTaxonomy") or {}
    parking_tables = result.get("parkingRuleTables") or []
    law_document_status = result.get("lawDocumentStatus") or {}

    return {
        "configured": True,
        "address": address,
        "status": result.get("status"),
        "provider": result.get("provider"),
        "jurisdiction": result.get("jurisdiction"),
        "message": result.get("message"),
        "lawDocumentStatus": law_document_status,
        "buildingUseTaxonomy": {
            "status": taxonomy.get("status"),
            "authoritative": taxonomy.get("authoritative"),
            "categoryCount": taxonomy.get("categoryCount"),
            "source": taxonomy.get("source"),
            "seedCoverage": {
                "seedCount": (taxonomy.get("seedCoverage") or {}).get("seedCount"),
                "matchedCount": (taxonomy.get("seedCoverage") or {}).get("matchedCount"),
            },
            "message": taxonomy.get("message"),
        },
        "parkingRuleTables": [
            {
                "source": table.get("source"),
                "ruleCount": len(table.get("rules") or []),
                "needsManualReview": table.get("needsManualReview"),
            }
            for table in parking_tables
        ],
        "providerResponses": [
            _response_summary(response)
            for response in result.get("providerResponses") or []
        ],
        "lawDocumentResponses": [
            {
                key: response.get(key)
                for key in ("status", "message", "error", "elapsedMs")
                if response.get(key)
            }
            for response in result.get("lawDocumentResponses") or []
        ],
    }


def print_human(summary: dict[str, Any]) -> None:
    print(f"LAW_OC configured: {summary.get('configured')}")
    print(f"Status: {summary.get('status')}")
    if summary.get("message"):
        print(f"Message: {summary['message']}")
    jurisdiction = summary.get("jurisdiction") or {}
    if jurisdiction.get("displayName"):
        print(f"Jurisdiction: {jurisdiction['displayName']}")

    documents = summary.get("lawDocumentStatus") or {}
    if documents:
        print(
            "Documents: "
            f"indexed={documents.get('indexed', 0)} "
            f"articles={documents.get('articleIndexed', 0)} "
            f"appendices={documents.get('appendixIndexed', 0)}"
        )

    taxonomy = summary.get("buildingUseTaxonomy") or {}
    if taxonomy:
        print(
            "Building use taxonomy: "
            f"status={taxonomy.get('status')} "
            f"authoritative={taxonomy.get('authoritative')} "
            f"categories={taxonomy.get('categoryCount')}"
        )
        source = taxonomy.get("source") or {}
        if source.get("lawTitle") or source.get("sectionTitle"):
            print(f"  Source: {source.get('lawTitle', '-')} / {source.get('sectionTitle', '-')}")
        if taxonomy.get("message"):
            print(f"  Message: {taxonomy['message']}")

    parking_tables = summary.get("parkingRuleTables") or []
    print(f"Parking rule tables: {len(parking_tables)}")
    for index, table in enumerate(parking_tables[:3], start=1):
        source = table.get("source") or {}
        print(
            f"  {index}. rules={table.get('ruleCount', 0)} "
            f"source={source.get('lawTitle', '-')} / {source.get('sectionTitle', '-')}"
        )

    print("Appendix search responses:")
    for response in summary.get("providerResponses") or []:
        if not response.get("purposeKey"):
            continue
        selected_titles = [
            reference.get("title", "-")
            for reference in response.get("selectedReferences") or []
        ]
        print(
            f"  - {response.get('purposeKey')}: "
            f"status={response.get('status')} "
            f"candidates={response.get('candidateCount', 0)} "
            f"selected={selected_titles}"
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--address", default="서울특별시 중구 세종대로 110")
    parser.add_argument("--json", action="store_true", help="Print sanitized JSON summary")
    args = parser.parse_args()

    summary = build_summary(args.address)
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print_human(summary)
    return 0 if summary.get("configured") else 1


if __name__ == "__main__":
    raise SystemExit(main())
