"""Parse parking appendix tables into calculable rule drafts."""

from __future__ import annotations

import re
import ast
from typing import Any

from engine.regulation.law_document import LawDocument


def _clean_cell(text: str) -> str:
    text = re.sub(r"[┃┏┓┗┛┣┫┠┨┯┷┿┼━─]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _normalize_lines(text: str) -> list[str]:
    raw = str(text or "").strip()
    if raw.startswith("["):
        try:
            parsed = ast.literal_eval(raw)
        except (SyntaxError, ValueError):
            parsed = None
        if parsed is not None:
            lines: list[str] = []

            def visit(value: Any) -> None:
                if isinstance(value, (list, tuple)):
                    for item in value:
                        visit(item)
                    return
                item_text = str(value or "").strip()
                if item_text:
                    lines.append(item_text)

            visit(parsed)
            if lines:
                return lines
    return raw.splitlines()


def _parse_table_rows(text: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    current: dict[str, str] | None = None

    for line in _normalize_lines(text):
        if "│" not in line or "┃" not in line:
            continue
        left, right = line.split("│", 1)
        facility = _clean_cell(left)
        standard = _clean_cell(right)
        if not facility and not standard:
            continue
        if facility in ("시설물", "설치기준"):
            continue

        match = re.match(r"^(\d+(?:-\d+)?)\.\s*(.+)", facility)
        if match:
            if current:
                rows.append(current)
            current = {
                "number": match.group(1),
                "facility": match.group(2).strip(),
                "standard": standard,
            }
            continue

        if current:
            if facility:
                current["facility"] = f"{current['facility']} {facility}".strip()
            if standard:
                current["standard"] = f"{current['standard']} {standard}".strip()

    if current:
        rows.append(current)
    return rows


def _parse_notes(text: str) -> list[str]:
    lines = _normalize_lines(text)
    note_start = next((index for index, line in enumerate(lines) if "<비고>" in line or line.strip() == "비고"), None)
    if note_start is not None:
        note_lines = lines[note_start + 1 :]
    else:
        note_lines = [line for line in lines if re.match(r"^\d+\.", line.strip())]
    notes: list[str] = []
    current: str | None = None
    for raw_line in note_lines:
        line = raw_line.strip()
        if not line:
            continue
        if re.match(r"^\d+\.", line):
            if current:
                notes.append(current)
            current = line
        elif current:
            current = f"{current} {line}".strip()
    if current:
        notes.append(current)
    return notes


def _method_from_standard(standard: str) -> dict[str, Any]:
    compact = standard.replace(" ", "")
    variants = _area_per_car_variants(standard)
    area_matches = re.findall(r"시설면적([0-9,]+)㎡당1대", compact)
    if area_matches:
        divisors = [float(value.replace(",", "")) for value in area_matches]
        default_divisor = _default_area_divisor(standard, divisors)
        return {
            "method": "area_per_car",
            "divisorM2": default_divisor,
            "additionalDivisorsM2": [value for value in divisors if value != default_divisor],
            "variants": variants,
            "formulaText": standard,
            "confidence": "high" if len(divisors) == 1 or default_divisor in divisors else "medium",
        }

    if "시설면적50㎡초과150㎡이하:1대" in compact and "150㎡초과" in compact:
        return {
            "method": "detached_house_piecewise",
            "formulaText": standard,
            "baseCars": 1,
            "thresholdM2": 150,
            "additionalDivisorM2": 100,
            "confidence": "medium",
        }

    person_match = re.search(r"정원([0-9,]+)인당1대", compact)
    if person_match:
        return {
            "method": "persons_per_car",
            "personsPerCar": float(person_match.group(1).replace(",", "")),
            "formulaText": standard,
            "confidence": "high",
        }

    hole_match = re.search(r"1홀당([0-9,]+)대", compact)
    if hole_match:
        return {
            "method": "cars_per_unit",
            "unit": "hole",
            "carsPerUnit": float(hole_match.group(1).replace(",", "")),
            "formulaText": standard,
            "confidence": "high",
        }

    bay_match = re.search(r"1타석당([0-9,]+)대", compact)
    if bay_match:
        return {
            "method": "cars_per_unit",
            "unit": "golf_practice_bay",
            "carsPerUnit": float(bay_match.group(1).replace(",", "")),
            "formulaText": standard,
            "confidence": "high",
        }

    if "주택건설기준등에관한규정" in compact:
        return {
            "method": "external_standard_reference",
            "referencedLaw": "주택건설기준 등에 관한 규정",
            "formulaText": standard,
            "confidence": "medium",
        }

    return {
        "method": "manual_review_required",
        "formulaText": standard,
        "confidence": "low",
    }


def _area_per_car_variants(standard: str) -> list[dict[str, Any]]:
    variants: list[dict[str, Any]] = []
    text = re.sub(r"\s+", " ", standard).strip()
    patterns = [
        r"([^:：○]+?)\s*[:：]\s*시설면적\s*([0-9,]+)\s*㎡\s*당\s*1대",
        r"○\s*([^:：]+?)\s*[:：]\s*시설면적\s*([0-9,]+)\s*㎡\s*당\s*1대",
    ]
    for pattern in patterns:
        for label, divisor in re.findall(pattern, text):
            clean_label = label.strip(" ,○")
            if not clean_label:
                continue
            value = float(divisor.replace(",", ""))
            if not any(item["label"] == clean_label and item["divisorM2"] == value for item in variants):
                variants.append(
                    {
                        "label": clean_label,
                        "keywords": _variant_keywords(clean_label),
                        "divisorM2": value,
                    }
                )
    return variants


def _variant_keywords(label: str) -> list[str]:
    keywords = [label]
    for token in ("일반업무", "공공업무", "학생용기숙사", "학교시설", "학교", "그 밖의 건축물"):
        if token in label and token not in keywords:
            keywords.append(token)
    return keywords


def _default_area_divisor(standard: str, divisors: list[float]) -> float:
    compact = standard.replace(" ", "")
    if "학생용기숙사,학교시설을제외한그밖의건축물" in compact:
        match = re.search(r"학생용기숙사,학교시설을제외한그밖의건축물:시설면적([0-9,]+)㎡당1대", compact)
        if match:
            return float(match.group(1).replace(",", ""))
    if "일반업무시설" in compact:
        match = re.search(r"일반업무시설:시설면적([0-9,]+)㎡당1대", compact)
        if match:
            return float(match.group(1).replace(",", ""))
    return divisors[0]


def _application_rules(notes: list[str]) -> dict[str, Any]:
    mixed_use_rule = next((note for note in notes if "복합" in note and "소수점 이하 첫째자리" in note), None)
    rounding_rule = next((note for note in notes if "0.5 이상" in note and "1로 본다" in note), None)
    return {
        "areaDefinition": next((note for note in notes if "공용면적" in note and "바닥면적" in note), None),
        "mixedUseRule": mixed_use_rule,
        "mixedUseRoundToDecimalPlaces": 1 if mixed_use_rule else None,
        "roundingRule": rounding_rule,
        "roundHalfUpFrom": 0.5 if rounding_rule else None,
        "totalLessThanOneBecomesZero": bool(rounding_rule and "총 주차대수가 1대 미만" in rounding_rule),
        "changeOfUseRule": next((note for note in notes if "용도변경" in note), None),
        "needsManualReview": True,
    }


def parse_parking_rules_from_text(
    text: str,
    source: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    if "주차장" not in text and "주차대수" not in text and "부설주차장" not in text:
        return None

    rows = _parse_table_rows(text)
    notes = _parse_notes(text)
    if not rows:
        return None

    rules = []
    for row in rows:
        method = _method_from_standard(row["standard"])
        rules.append(
            {
                "number": row["number"],
                "facility": row["facility"],
                "standard": row["standard"],
                "calculation": method,
                "needsManualReview": method["confidence"] != "high",
            }
        )

    return {
        "source": source or {},
        "ruleType": "parking_required_count",
        "rules": rules,
        "notes": notes,
        "applicationRules": _application_rules(notes),
        "needsManualReview": True,
    }


def parse_parking_rules_from_documents(documents: list[LawDocument]) -> list[dict[str, Any]]:
    parsed: list[dict[str, Any]] = []
    for document in documents:
        for section in document.sections:
            if section.section_type != "appendix":
                continue
            if "주차" not in f"{document.title} {section.title} {section.text}":
                continue
            result = parse_parking_rules_from_text(
                section.text,
                source={
                    "lawTitle": document.title,
                    "sectionTitle": section.title,
                    "sectionId": section.id,
                    "url": (document.reference or {}).get("url"),
                    "effectiveDate": (document.reference or {}).get("effectiveDate"),
                },
            )
            if result:
                parsed.append(result)
    return parsed
