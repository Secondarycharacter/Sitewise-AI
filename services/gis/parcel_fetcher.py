import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from services.gis import geo_utils
from services.gis.juso_client import search_juso_address
from services.gis.pnu_builder import resolve_pnu
from services.gis.vworld_client import (
    VWorldError,
    VWorldPermissionError,
    extract_point_from_geocode,
    extract_point_from_search,
    geocode_address,
    get_land_characteristics,
    get_land_use_attr,
    get_parcel_features_in_bbox,
    get_parcel_feature_at_point,
    search_address,
)

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

JIMOK_CODE_TO_NAME: dict[str, str] = {
    "01": "전",
    "02": "답",
    "03": "과수원",
    "04": "목장용지",
    "05": "임야",
    "06": "광천지",
    "07": "염전",
    "08": "대",
    "09": "공장용지",
    "10": "학교용지",
    "11": "주차장",
    "12": "주유소용지",
    "13": "창고용지",
    "14": "도",
    "15": "철도용지",
    "16": "제방",
    "17": "하천",
    "18": "구거",
    "19": "유지",
    "20": "양어장",
    "21": "수도용지",
    "22": "공원",
    "23": "체육용지",
    "24": "유원지",
    "25": "종교용지",
    "26": "사적지",
    "27": "묘지",
    "28": "잡종지",
}
JIMOK_NAME_TO_CODE = {name: code for code, name in JIMOK_CODE_TO_NAME.items()}
JIMOK_NAME_TO_CODE.update(
    {
        "임": "05",
        "대지": "08",
        "장": "09",
        "학": "10",
        "도로": "14",
        "천": "17",
    }
)
ROAD_JIMOK_CODES = {"14"}
ROAD_JIMOK_NAMES = {"도", "도로"}
ROAD_LIKE_LAND_USE_KEYWORDS = ("도로", "도로등")
_LAND_CHARACTERISTICS_CACHE: dict[str, dict[str, Any]] = {}


def _unwrap_field_list(payload: dict[str, Any], *keys: str) -> list[dict[str, Any]]:
    node: Any = payload
    for key in keys:
        if not isinstance(node, dict):
            return []
        node = node.get(key)

    if isinstance(node, list):
        return node
    if isinstance(node, dict):
        field = node.get("field")
        if isinstance(field, list):
            return field
        if isinstance(field, dict):
            return [field]
    return []


def _parse_land_characteristics(data: dict[str, Any]) -> dict[str, Any]:
    fields = _unwrap_field_list(data, "landCharacteristics")
    if not fields:
        fields = _unwrap_field_list(data, "landCharacteristicss")

    if not fields:
        return {}

    field = fields[0]
    area_raw = field.get("lndpclAr") or field.get("lndpcl_ar") or 0
    try:
        area = float(area_raw)
    except (TypeError, ValueError):
        area = 0.0

    return {
        "pnu": field.get("pnu"),
        "jimok": field.get("lndcgrCodeNm") or field.get("lndcgr_code_nm"),
        "jimok_code": field.get("lndcgrCode") or field.get("lndcgr_code"),
        "area_m2": area,
        "zone_primary": field.get("prposArea1Nm") or field.get("prposArea1_nm"),
        "zone_secondary": field.get("prposArea2Nm") or field.get("prposArea2_nm"),
        "land_use_situation": field.get("ladUseSittnNm"),
        "road_side": field.get("roadSideCodeNm"),
        "official_land_price": field.get("pblntfPclnd"),
    }


def _parse_land_use_zones(data: dict[str, Any]) -> list[str]:
    fields = _unwrap_field_list(data, "landUses", "field")
    if not fields:
        fields = _unwrap_field_list(data, "landUses")

    zones: list[str] = []
    for field in fields:
        name = (
            field.get("prposAreaDstrcCodeNm")
            or field.get("prpos_area_dstrc_code_nm")
            or field.get("prposAreaDstrcCode")
        )
        if name and name not in zones:
            zones.append(str(name))
    return zones


def _normalize_jimok_code(code: str | int | None) -> str | None:
    if code is None:
        return None
    text = str(code).strip()
    if not text:
        return None
    return text.zfill(2)


def resolve_jimok_code(jimok: str | None, jimok_code: str | int | None) -> str | None:
    name = str(jimok or "").strip()
    if name in JIMOK_NAME_TO_CODE:
        return JIMOK_NAME_TO_CODE[name]

    normalized_code = _normalize_jimok_code(jimok_code)
    if normalized_code:
        return normalized_code

    return None


def _jimok_from_jibun(jibun: str | None) -> tuple[str | None, str | None]:
    if not jibun:
        return None, None

    text = str(jibun).strip()
    tokens = text.split()
    if not tokens:
        return None, None

    for token in reversed(tokens):
        name = token.strip()
        code = JIMOK_NAME_TO_CODE.get(name)
        if code:
            return name, code

    for name in sorted(JIMOK_NAME_TO_CODE, key=len, reverse=True):
        if text.endswith(name):
            return name, JIMOK_NAME_TO_CODE[name]

    return None, None


def _is_road_jimok(jimok: str | None, jimok_code: str | int | None) -> bool:
    normalized_name = (jimok or "").strip()
    return (
        resolve_jimok_code(jimok, jimok_code) in ROAD_JIMOK_CODES
        or normalized_name in ROAD_JIMOK_NAMES
    )


def _is_road_like_land_use(land: dict[str, Any] | None) -> bool:
    if not land:
        return False

    land_use = str(land.get("land_use_situation") or "").strip()
    return any(keyword in land_use for keyword in ROAD_LIKE_LAND_USE_KEYWORDS)


def _cached_land_characteristics(pnu: str | None) -> dict[str, Any]:
    if not pnu:
        return {}

    if pnu in _LAND_CHARACTERISTICS_CACHE:
        return _LAND_CHARACTERISTICS_CACHE[pnu]

    try:
        land = _parse_land_characteristics(get_land_characteristics(pnu))
    except VWorldError:
        land = {}

    _LAND_CHARACTERISTICS_CACHE[pnu] = land
    return land


def _land_jimok_for_feature(
    props: dict[str, Any], pnu: str | None
) -> tuple[str | None, str | None]:
    direct_name = (
        props.get("lndcgrCodeNm")
        or props.get("lndcgr_code_nm")
        or props.get("jimok")
    )
    direct_code = _normalize_jimok_code(
        props.get("lndcgrCode")
        or props.get("lndcgr_code")
        or props.get("jimok_code")
    )
    direct_name = str(direct_name).strip() if direct_name else None
    if direct_name and JIMOK_NAME_TO_CODE.get(direct_name):
        return direct_name, JIMOK_NAME_TO_CODE[direct_name]
    if direct_code and direct_code in JIMOK_CODE_TO_NAME:
        return JIMOK_CODE_TO_NAME[direct_code], direct_code

    bonbun_bubun = " ".join(
        str(value)
        for value in (props.get("bonbun"), props.get("bubun"))
        if value
    )
    for text in (props.get("jibun"), props.get("addr"), bonbun_bubun):
        jimok, jimok_code = _jimok_from_jibun(text)
        if jimok and jimok_code:
            return jimok, jimok_code

    # Fallback only when cadastral attributes do not include 지목 text.
    if not pnu:
        return None, None

    land = _cached_land_characteristics(pnu)
    if not land:
        return None, None

    return land.get("jimok"), _normalize_jimok_code(land.get("jimok_code"))


def _is_demo_mode() -> bool:
    return os.getenv("FAM_DEMO_MODE", "").lower() in ("1", "true", "yes")


def _demo_parcel(address: str) -> dict[str, Any]:
    x, y = 127.0276, 37.4979
    coords = geo_utils.approximate_parcel_coords(x, y, side_m=18.0)
    return {
        "address": address,
        "road_address": None,
        "pnu": None,
        "coordinates": coords,
        "centroid": (x, y),
        "area_m2": 330.0,
        "land": {
            "zone_primary": "제2종일반주거지역",
            "zone_secondary": None,
            "jimok": "대",
        },
        "districts": ["제2종일반주거지역"],
        "geometry_source": "demo",
        "warnings": ["데모 모드(FAM_DEMO_MODE=true) — 실제 지번 데이터가 아닙니다."],
    }


def get_parcel_info(address: str) -> dict[str, Any]:
    if _is_demo_mode():
        return _demo_parcel(address)

    warnings: list[str] = []

    try:
        search_data = search_address(address)
        x, y, structure = extract_point_from_search(search_data)
    except VWorldError:
        geocode_data = geocode_address(address)
        x, y, structure = extract_point_from_geocode(geocode_data)

    pnu = structure.get("pnu") or resolve_pnu(structure, address)
    coords: list[tuple[float, float]] = []
    source = "approximate"

    try:
        feature = get_parcel_feature_at_point(x, y)
        if feature:
            geometry = feature.get("geometry") or {}
            coords = geo_utils.parse_polygon_coordinates(geometry)
            props = feature.get("properties") or {}
            if not pnu:
                pnu = props.get("pnu") or props.get("PNU")
            jibun = props.get("jibun") or props.get("addr")
            if jibun and not structure.get("text"):
                structure["text"] = jibun
            if len(coords) >= 3:
                source = "cadastral"
    except VWorldPermissionError as exc:
        warnings.append(str(exc))
    except VWorldError as exc:
        warnings.append(str(exc))

    if len(coords) < 3:
        coords = geo_utils.approximate_parcel_coords(x, y)
        warnings.append(
            "실제 필지 경계를 불러오지 못해 검색 좌표 기준 근사 형상을 사용했습니다."
        )

    land_char: dict[str, Any] = {}
    land_use_zones: list[str] = []

    if pnu:
        try:
            land_char = _parse_land_characteristics(get_land_characteristics(pnu))
        except VWorldPermissionError as exc:
            warnings.append(str(exc))
        except VWorldError as exc:
            warnings.append(f"토지특성 조회 실패: {exc}")

        try:
            land_use_zones = _parse_land_use_zones(get_land_use_attr(pnu))
        except VWorldPermissionError:
            pass
        except VWorldError:
            pass

    area_m2: float | None = None
    if land_char.get("area_m2"):
        area_m2 = round(float(land_char["area_m2"]), 2)
    elif source == "cadastral":
        area_m2 = round(geo_utils.polygon_area_m2_wgs84(coords), 2)
    else:
        warnings.append(
            "대지면적은 토지특성 API 조회 결과가 있어야 표시됩니다."
        )

    juso_address = search_juso_address(address)
    fallback_jibun_address = structure.get("text") or address

    return {
        "address": juso_address.get("jibun_address") or fallback_jibun_address,
        "road_address": juso_address.get("road_address") or structure.get("road"),
        "pnu": pnu,
        "coordinates": coords,
        "centroid": (x, y),
        "area_m2": area_m2,
        "land": land_char,
        "districts": land_use_zones,
        "geometry_source": source,
        "warnings": warnings,
    }


def get_parcel_coordinates(address: str) -> list[tuple[float, float]]:
    info = get_parcel_info(address)
    return info["coordinates"]


def get_surrounding_parcels(
    target_coords: list[tuple[float, float]],
    target_pnu: str | None,
    radius_m: float = 50.0,
) -> list[dict[str, Any]]:
    if len(target_coords) < 3:
        return []

    try:
        features = get_parcel_features_in_bbox(
            geo_utils.buffered_bbox(target_coords, radius_m)
        )
    except VWorldError:
        return []

    parcels: list[dict[str, Any]] = []
    seen: set[str] = set()

    for feature in features:
        props = feature.get("properties") or {}
        pnu = props.get("pnu") or props.get("PNU")
        if pnu == target_pnu or (pnu and pnu in seen):
            continue

        coords = geo_utils.parse_polygon_coordinates(feature.get("geometry") or {})
        if len(coords) < 3:
            continue

        if geo_utils.polygon_distance_m(target_coords, coords) > radius_m:
            continue

        jimok, jimok_code = _land_jimok_for_feature(props, pnu)
        land_characteristics = _cached_land_characteristics(pnu)
        is_road = _is_road_jimok(jimok, jimok_code) or _is_road_like_land_use(
            land_characteristics
        )
        parcels.append(
            {
                "pnu": pnu,
                "jibun": props.get("jibun"),
                "address": props.get("addr"),
                "coordinates": coords,
                "jimok": jimok,
                "jimok_code": jimok_code,
                "land_use_situation": land_characteristics.get("land_use_situation"),
                "is_road": is_road,
            }
        )

        if pnu:
            seen.add(pnu)

    return parcels
