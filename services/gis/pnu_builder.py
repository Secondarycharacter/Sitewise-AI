import re
from typing import Any


def resolve_pnu(structure: dict[str, Any], address: str) -> str | None:
    from services.gis.vworld_client import build_pnu_from_structure

    existing = structure.get("pnu")
    if existing and str(existing).isdigit() and len(str(existing)) == 19:
        return str(existing)

    text = structure.get("text") or address
    return build_pnu_from_structure(structure, text)


def parse_jibun_numbers(text: str) -> tuple[str, str, str] | None:
    cleaned = text.strip()
    is_mountain = "산" in cleaned
    numbers = re.sub(r"산", "", cleaned)
    found = re.findall(r"\d+", numbers)
    if not found:
        return None

    bonbun = found[0].zfill(4)
    bubun = found[1].zfill(4) if len(found) > 1 else "0000"
    san = "2" if is_mountain else "1"
    return san, bonbun, bubun
