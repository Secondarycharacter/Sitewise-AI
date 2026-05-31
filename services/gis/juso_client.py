import os
from typing import Any

import requests


JUSO_SEARCH_URL = "https://business.juso.go.kr/addrlink/addrLinkApi.do"


def search_juso_address(keyword: str) -> dict[str, Any]:
    confirm_key = (
        os.getenv("JUSO_API_KEY")
        or os.getenv("JUSO_CONFIRM_KEY")
        or os.getenv("JUSO_CONFM_KEY")
    )
    if not confirm_key or not keyword.strip():
        return {}

    params = {
        "confmKey": confirm_key,
        "currentPage": "1",
        "countPerPage": "1",
        "keyword": keyword,
        "resultType": "json",
    }
    try:
        response = requests.get(JUSO_SEARCH_URL, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
    except (requests.RequestException, ValueError):
        return {}

    results = data.get("results") or {}
    common = results.get("common") or {}
    if str(common.get("errorCode")) != "0":
        return {}

    items = results.get("juso") or []
    if not items:
        return {}

    item = items[0]
    return {
        "jibun_address": item.get("jibunAddr"),
        "road_address": item.get("roadAddr"),
    }
