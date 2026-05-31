import os
import re
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

API_KEY = os.getenv("VWORLD_API_KEY", "")
DOMAIN = os.getenv("VWORLD_DOMAIN", "http://localhost:3000")

SEARCH_URL = "https://api.vworld.kr/req/search"
ADDRESS_URL = "https://api.vworld.kr/req/address"
DATA_URL = "https://api.vworld.kr/req/data"
LAND_CHAR_URL = "https://api.vworld.kr/ned/data/getLandCharacteristics"
LAND_USE_URL = "https://api.vworld.kr/ned/data/getLandUseAttr"


class VWorldError(Exception):
    pass


class VWorldPermissionError(VWorldError):
    """인증키에 해당 API 권한이 없을 때."""


def _base_params() -> dict[str, str]:
    if not API_KEY:
        raise VWorldError(
            "VWORLD_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요."
        )
    params: dict[str, str] = {"key": API_KEY}
    if DOMAIN:
        params["domain"] = DOMAIN
    return params


def _find_error_code(payload: dict[str, Any]) -> str | None:
    response = payload.get("response") if isinstance(payload.get("response"), dict) else {}
    error = response.get("error") if isinstance(response.get("error"), dict) else {}
    code = error.get("code")
    if code:
        return str(code)

    for value in payload.values():
        if isinstance(value, dict):
            nested = value.get("resultCode") or value.get("result_code")
            if nested:
                return str(nested)
    return None


def _ensure_ok(payload: dict[str, Any], service: str) -> None:
    code = _find_error_code(payload)
    if code == "INCORRECT_KEY":
        raise VWorldPermissionError(
            f"VWorld '{service}' API 권한이 없습니다. "
            "vworld.kr 개발자센터에서 '2D데이터 API'·'국가중점데이터(토지특성)' 권한을 추가 신청하세요."
        )
    if code:
        raise VWorldError(f"VWorld API 오류 ({service}): {code}")

    response = payload.get("response")
    if isinstance(response, dict) and response.get("status") == "ERROR":
        error = response.get("error", {})
        raise VWorldError(
            f"VWorld API 오류 ({service}): {error.get('text', error.get('code', 'UNKNOWN'))}"
        )


def search_address(address: str) -> dict[str, Any]:
    params = {
        **_base_params(),
        "service": "search",
        "request": "search",
        "version": "2.0",
        "crs": "EPSG:4326",
        "size": "10",
        "page": "1",
        "query": address,
        "type": "ADDRESS",
        "category": "PARCEL",
        "format": "json",
    }
    response = requests.get(SEARCH_URL, params=params, timeout=20)
    response.raise_for_status()
    data = response.json()
    _ensure_ok(data, "주소검색")
    return data


def geocode_address(address: str) -> dict[str, Any]:
    params = {
        **_base_params(),
        "service": "address",
        "request": "getcoord",
        "version": "2.0",
        "crs": "EPSG:4326",
        "address": address,
        "format": "json",
        "type": "PARCEL",
    }
    response = requests.get(ADDRESS_URL, params=params, timeout=20)
    response.raise_for_status()
    data = response.json()
    _ensure_ok(data, "지오코딩")
    return data


def get_parcel_feature_at_point(x: float, y: float) -> dict[str, Any] | None:
    params = {
        **_base_params(),
        "service": "data",
        "request": "getfeature",
        "version": "2.0",
        "format": "json",
        "size": "5",
        "page": "1",
        "geometry": "true",
        "attribute": "true",
        "crs": "EPSG:4326",
        "data": "LP_PA_CBND_BUBUN",
        "geomfilter": f"POINT({x} {y})",
    }
    response = requests.get(DATA_URL, params=params, timeout=20)
    response.raise_for_status()
    data = response.json()
    _ensure_ok(data, "연속지적도")

    features = (
        data.get("response", {})
        .get("result", {})
        .get("featureCollection", {})
        .get("features", [])
    )
    if not features:
        return None

    return features[0]


def get_parcel_features_in_bbox(
    bbox: tuple[float, float, float, float], size: int = 1000
) -> list[dict[str, Any]]:
    min_x, min_y, max_x, max_y = bbox
    params = {
        **_base_params(),
        "service": "data",
        "request": "getfeature",
        "version": "2.0",
        "format": "json",
        "size": str(size),
        "page": "1",
        "geometry": "true",
        "attribute": "true",
        "crs": "EPSG:4326",
        "data": "LP_PA_CBND_BUBUN",
        "geomfilter": f"BOX({min_x},{min_y},{max_x},{max_y})",
    }
    response = requests.get(DATA_URL, params=params, timeout=20)
    response.raise_for_status()
    data = response.json()
    _ensure_ok(data, "주변 연속지적도")

    return (
        data.get("response", {})
        .get("result", {})
        .get("featureCollection", {})
        .get("features", [])
    )


def get_land_characteristics(pnu: str, stdr_year: str | None = None) -> dict[str, Any]:
    from datetime import datetime

    year = stdr_year or str(datetime.now().year - 1)
    params = {
        **_base_params(),
        "pnu": pnu,
        "stdrYear": year,
        "format": "json",
        "numOfRows": "10",
        "pageNo": "1",
    }
    response = requests.get(LAND_CHAR_URL, params=params, timeout=20)
    response.raise_for_status()
    data = response.json()
    _ensure_ok(data, "토지특성")
    return data


def get_land_use_attr(pnu: str) -> dict[str, Any]:
    params = {
        **_base_params(),
        "pnu": pnu,
        "format": "json",
        "numOfRows": "100",
        "pageNo": "1",
    }
    response = requests.get(LAND_USE_URL, params=params, timeout=20)
    response.raise_for_status()
    data = response.json()
    _ensure_ok(data, "토지이용계획")
    return data


def build_pnu_from_structure(structure: dict[str, Any], jibun: str) -> str | None:
    level4 = structure.get("level4LC") or structure.get("level4lc")
    if not level4 or len(str(level4)) != 10:
        return None

    is_mountain = "산" in jibun
    san_yn = "2" if is_mountain else "1"

    numbers = re.sub(r"산", "", jibun)
    numbers = re.findall(r"\d+", numbers)
    if not numbers:
        level5 = structure.get("level5", "")
        numbers = re.findall(r"\d+", str(level5))

    if not numbers:
        return None

    bonbun = numbers[0].zfill(4)
    bubun = numbers[1].zfill(4) if len(numbers) > 1 else "0000"
    return f"{level4}{san_yn}{bonbun}{bubun}"


def extract_point_from_search(data: dict[str, Any]) -> tuple[float, float, dict[str, Any]]:
    items = data.get("response", {}).get("result", {}).get("items", [])
    if not items:
        raise VWorldError("주소 검색 결과가 없습니다.")

    item = items[0]
    point = item.get("point") or {}
    x = float(point.get("x"))
    y = float(point.get("y"))

    address_info = item.get("address") or {}
    pnu = item.get("id")
    parcel_text = address_info.get("parcel") or item.get("title", "")

    structure: dict[str, Any] = {
        "text": parcel_text,
        "road": address_info.get("road"),
        "zipcode": address_info.get("zipcode"),
    }

    if pnu and str(pnu).isdigit() and len(str(pnu)) == 19:
        structure["pnu"] = str(pnu)
        structure["level4LC"] = str(pnu)[:10]

    return x, y, structure


def extract_point_from_geocode(data: dict[str, Any]) -> tuple[float, float, dict[str, Any]]:
    result = data.get("response", {}).get("result", {})
    point = result.get("point") or {}
    x = float(point.get("x"))
    y = float(point.get("y"))

    structure = result.get("structure") or {}
    structure["text"] = result.get("text") or structure.get("level4L", "")
    return x, y, structure
